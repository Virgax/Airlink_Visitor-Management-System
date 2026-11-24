import "server-only";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { extractMrzFromTexts, type MrzIdentity } from "@/lib/mrz/extract";
import { log } from "@/lib/log";

/**
 * Reads the machine-readable zone of an identity document photographed with a phone: the back of the Dominican
 * cédula (three lines) or a passport's data page (two lines). OCR runs here, in the web replica, with the OCR-B model
 * in data/tessdata (tesseract.js, WASM); nothing leaves the server. The photo is read as uploaded: the caller stores
 * it (or not) independently.
 */
const LANG_DIR = path.join(process.cwd(), "data", "tessdata");
const IDLE_MS = 5 * 60_000;
const MRZ_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";
/** Pre-processing passes, cheapest first; reading stops as soon as two passes agree on a fully valid MRZ. */
const PASSES: { width: number; threshold?: number }[] = [{ width: 1500, threshold: 130 }, { width: 1800 }, { width: 1200 }];

let workerPromise: Promise<Worker> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await createWorker("mrz", 1, { langPath: LANG_DIR, gzip: false, cacheMethod: "none" });
      await w.setParameters({ tessedit_char_whitelist: MRZ_ALPHABET, tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      return w;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

function touchIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const p = workerPromise;
    workerPromise = null;
    void p?.then((w) => w.terminate()).catch(() => undefined);
  }, IDLE_MS);
  idleTimer.unref?.();
}

async function ocr(worker: Worker, image: Sharp, pass: { width: number; threshold?: number }): Promise<string> {
  let img = image.clone().grayscale().resize({ width: pass.width, withoutEnlargement: true }).normalize();
  if (pass.threshold) img = img.threshold(pass.threshold);
  const { data } = await worker.recognize(await img.png().toBuffer());
  return data.text;
}

/** The MRZ identity in the photo, or null when none is readable. Serialized: one OCR at a time per replica. */
export async function readMrzFromImage(bytes: Uint8Array): Promise<MrzIdentity | null> {
  const run = async (): Promise<MrzIdentity | null> => {
    const started = Date.now();
    const worker = await getWorker();
    touchIdle();
    const image = sharp(Buffer.from(bytes)).rotate();
    const texts: string[] = [];
    let result: MrzIdentity | null = null;
    for (const pass of PASSES) {
      texts.push(await ocr(worker, image, pass));
      const next = extractMrzFromTexts(texts);
      // Two passes that agree on a valid MRZ: no need for a third.
      if (next?.valid && result?.valid && next.lines.join() === result.lines.join()) {
        result = next;
        break;
      }
      result = next ?? result;
    }
    log.info("mrz.read", { found: Boolean(result), valid: result?.valid ?? false, docType: result?.docType ?? null, passes: texts.length, ms: Date.now() - started });
    return result;
  };
  const job = queue.then(run, run);
  queue = job.catch(() => undefined);
  return job;
}
