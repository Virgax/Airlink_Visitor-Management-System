import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `notify()` with NOTIFY_FAKE=1 (vitest.config.ts): rows are "stored" through a mocked Prisma client and the
 * channels only write to `__fakeOutbox`. No database needed.
 */

type FakeUser = {
  id: string;
  email: string;
  name: string;
  locale: string | null;
  status: "active" | "disabled";
  employeeId: string | null;
  notificationPref: { quietFrom: string | null; quietTo: string | null; prefs: Record<string, unknown> } | null;
  pushSubscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[];
};

const state = vi.hoisted(() => ({
  users: [] as FakeUser[],
  stored: [] as { userId: string; type: string; payload: Record<string, unknown> }[],
  deletedSubs: [] as string[],
  siteLookupThrows: false,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; employeeId?: { in: string[] } } }) => {
        if (where.employeeId) return state.users.filter((u) => u.employeeId && where.employeeId!.in.includes(u.employeeId) && u.status === "active").map((u) => ({ id: u.id }));
        return state.users.filter((u) => where.id!.in.includes(u.id) && u.status === "active");
      }),
    },
    notification: {
      createMany: vi.fn(async ({ data }: { data: { userId: string; type: string; payload: Record<string, unknown> }[] }) => {
        state.stored.push(...data);
        return { count: data.length };
      }),
    },
    site: {
      findUnique: vi.fn(async () => {
        if (state.siteLookupThrows) throw new Error("db down");
        return { name: "Airlink 2", timezone: "America/Santo_Domingo" };
      }),
    },
    pushSubscription: {
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        state.deletedSubs.push(...where.id.in);
        return { count: where.id.in.length };
      }),
    },
  },
}));

import { notify } from "@/lib/notifications";
import { __fakeOutbox, clearFakeOutbox } from "@/lib/notifications/fake";

function user(partial: Partial<FakeUser> & { id: string }): FakeUser {
  return {
    email: `${partial.id}@airlink.test`,
    name: partial.id,
    locale: null,
    status: "active",
    employeeId: null,
    notificationPref: null,
    pushSubscriptions: [],
    ...partial,
  };
}

const sub = (id: string) => ({ id, endpoint: `https://push.example/${id}`, p256dh: "p", auth: "a" });

beforeEach(() => {
  state.users = [];
  state.stored = [];
  state.deletedSubs = [];
  state.siteLookupThrows = false;
  clearFakeOutbox();
  process.env.NOTIFY_FAKE = "1";
  process.env.TEAMS_ACTION_SECRET = "test-teams-action-secret";
});

describe("notify() dispatch with NOTIFY_FAKE=1", () => {
  it("stores one row per recipient, pushes in the reader's language and posts one Teams card with signed actions", async () => {
    state.users = [
      user({ id: "u-es", pushSubscriptions: [sub("s1"), sub("s2")] }),
      user({ id: "u-en", locale: "en", employeeId: "emp-1", pushSubscriptions: [sub("s3")] }),
    ];
    const res = await notify({
      type: "visit_at_gate",
      userIds: ["u-es"],
      employeeIds: ["emp-1"],
      siteId: "site-1",
      payload: { visitId: "clvisit1", visitorName: "Juan Pérez", company: "Uptime", gateName: "Recepción" },
    });
    expect(res.stored).toBe(2);
    expect(state.stored.map((r) => r.userId).sort()).toEqual(["u-en", "u-es"]);
    expect(state.stored[0]?.payload).toMatchObject({ visitId: "clvisit1", siteId: "site-1" });

    const pushes = __fakeOutbox.filter((e) => e.channel === "push");
    expect(pushes).toHaveLength(3);
    expect(pushes.find((p) => p.to.endsWith("/s1"))?.title).toBe("Visitante en portería");
    expect(pushes.find((p) => p.to.endsWith("/s3"))?.title).toBe("Visitor at the gate");
    expect(pushes[0]?.url).toBe("http://localhost:3000/app/notifications");

    const teams = __fakeOutbox.filter((e) => e.channel === "teams");
    expect(teams).toHaveLength(1);
    const actions = teams[0]?.extra?.actions as { approveUrl: string; denyUrl: string };
    expect(actions.approveUrl).toMatch(/^http:\/\/localhost:3000\/api\/teams\/action\?token=visit\.clvisit1\.approved\.\d+\.[A-Za-z0-9_-]+$/);
    expect(actions.denyUrl).toContain("token=visit.clvisit1.denied.");
    const card = teams[0]?.extra?.card as { attachments: { content: { actions: { title: string }[] } }[] };
    expect(card.attachments[0]?.content.actions.map((a) => a.title)).toEqual(["Aprobar", "Rechazar", "Abrir Airlink Visitas"]);
    expect(__fakeOutbox.filter((e) => e.channel === "email")).toHaveLength(0);
  });

  it("falls back to email only when the user has no push subscription and opted in", async () => {
    state.users = [
      user({ id: "u-mail", notificationPref: { quietFrom: null, quietTo: null, prefs: { emailFallback: true } } }),
      user({ id: "u-silent" }),
      user({ id: "u-push", pushSubscriptions: [sub("s9")], notificationPref: { quietFrom: null, quietTo: null, prefs: { emailFallback: true } } }),
    ];
    await notify({ type: "visit_entered", userIds: ["u-mail", "u-silent", "u-push"], siteId: null, payload: { visitorName: "Ana" } });
    const emails = __fakeOutbox.filter((e) => e.channel === "email");
    expect(emails.map((e) => e.to)).toEqual(["u-mail@airlink.test"]);
    expect(emails[0]?.title).toBe("Tu visitante ya entró");
    expect(__fakeOutbox.filter((e) => e.channel === "push").map((e) => e.to)).toEqual(["https://push.example/s9"]);
    // visit_entered is not a Teams type
    expect(__fakeOutbox.filter((e) => e.channel === "teams")).toHaveLength(0);
  });

  it("honors quiet hours for normal types but not for urgent ones; rows are always stored", async () => {
    const allDay = { quietFrom: "00:00", quietTo: "24:00", prefs: {} };
    state.users = [user({ id: "u-quiet", pushSubscriptions: [sub("q1")], notificationPref: allDay })];
    await notify({ type: "pass_approved", userIds: ["u-quiet"], siteId: "site-1", payload: { passId: "p1", visitorName: "Ana" } });
    expect(state.stored).toHaveLength(1);
    expect(__fakeOutbox).toHaveLength(0);

    await notify({ type: "blacklist_hit", userIds: ["u-quiet"], siteId: "site-1", payload: { visitorName: "Ana", gateName: "Muelle" } });
    expect(__fakeOutbox.filter((e) => e.channel === "push")).toHaveLength(1);
  });

  it("sends daily_report by email only", async () => {
    state.users = [user({ id: "u-rep", pushSubscriptions: [sub("r1")] })];
    await notify({ type: "daily_report", userIds: ["u-rep"], siteId: "site-1", payload: { count: 4, siteName: "Airlink 2", date: "2026-10-26" } });
    expect(__fakeOutbox.map((e) => e.channel)).toEqual(["email"]);
    expect(__fakeOutbox[0]?.body).toBe("4 visitas en Airlink 2 el 2026-10-26.");
  });

  it("still posts the Teams card when nobody is a direct recipient", async () => {
    const res = await notify({ type: "blacklist_hit", userIds: [], siteId: "site-1", payload: { visitorName: "X", gateName: "Recepción" } });
    expect(res.stored).toBe(0);
    expect(state.stored).toHaveLength(0);
    expect(__fakeOutbox.map((e) => e.channel)).toEqual(["teams"]);
  });

  it("never throws out of notify() when a channel step fails", async () => {
    state.users = [user({ id: "u-ok", pushSubscriptions: [sub("k1")] })];
    state.siteLookupThrows = true;
    await expect(notify({ type: "visit_left", userIds: ["u-ok"], siteId: "site-1", payload: { visitorName: "Ana" } })).resolves.toEqual({ stored: 1 });
  });
});
