/**
 * Builds the printable manual (public/help/guia-airlink-visitas.pdf) from the in-app help: the guides in
 * messages/es.json ordered by role, the screenshots in public/help, plus the visitor chapter and the FAQ written
 * here (there is no in-app guide for visitors: they only see their link). Run after `npm run help:screenshots`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { HELP_GUIDES, type HelpGuide } from "../src/lib/help/guides";

type Step = { title: string; body: string };
type Messages = { help: { guides: Record<string, { title: string; summary: string; steps: Record<string, Step> }> } };

const ROOT = process.cwd();
const OUT = join(ROOT, "public", "help", "guia-airlink-visitas.pdf");
const APP_URL = process.env.APP_URL?.replace(/\/$/, "") || "https://web-production-29b52.up.railway.app";
const messages = JSON.parse(readFileSync(join(ROOT, "messages", "es.json"), "utf8")) as Messages;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paras = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("- ") ? `<li>${esc(l.slice(2))}</li>` : `<p>${esc(l)}</p>`))
    .join("")
    .replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
/** Rendered <figure> per screenshot, filled by `renderShots` before the HTML is built. */
const SHOTS = new Map<string, string>();
const img = (shot: string, kiosk = false) => {
  const html = SHOTS.get(shot);
  if (!html) throw new Error(`screenshot not rendered: ${shot}`);
  return kiosk ? html.replace('<figure class="', '<figure class="kiosk ') : html;
};
/** Tall phone captures are cut into strips so the page can break between them instead of pushing the whole image to a new page. */
/** Strip height as a multiple of the image width: at 62% of the page width a strip takes about 60% of a page. */
const STRIP_RATIO = 1.25;
async function renderShot(shot: string): Promise<string> {
  const buf = readFileSync(join(ROOT, "public", "help", `${shot}.png`));
  const width = buf.readUInt32BE(16); // PNG IHDR
  const height = buf.readUInt32BE(20);
  if (height <= width * 1.6) return `<figure class=""><img src="data:image/png;base64,${buf.toString("base64")}" alt="" /></figure>`;
  const strips: string[] = [];
  const stripPx = Math.round(width * STRIP_RATIO);
  for (let top = 0; top < height; top += stripPx) {
    const part = await sharp(buf).extract({ left: 0, top, width, height: Math.min(stripPx, height - top) }).png().toBuffer();
    strips.push(`<img src="data:image/png;base64,${part.toString("base64")}" alt="" />`);
  }
  return `<figure class="tall">${strips.join("")}</figure>`;
}
async function renderShots(): Promise<void> {
  const names = new Set<string>(["visitor-register", "visitor-link"]);
  for (const g of HELP_GUIDES) for (const st of g.steps) if (st.shot) names.add(st.shot);
  for (const n of names) SHOTS.set(n, await renderShot(n));
}

function guideHtml(slug: string, number: string, first = false): string {
  const g = HELP_GUIDES.find((x) => x.slug === slug) as HelpGuide;
  const t = messages.help.guides[slug]!;
  const steps = g.steps
    .map((s, i) => {
      const st = t.steps[s.key]!;
      return `<section class="step"><h3><span class="n">${i + 1}</span>${esc(st.title)}</h3>${paras(st.body)}${s.shot ? img(s.shot, Boolean(s.kiosk)) : ""}</section>`;
    })
    .join("");
  return `<section class="guide${first ? " first" : ""}"><h2 id="${slug}">${number} ${esc(t.title)}</h2><p class="summary">${esc(t.summary)}</p>${steps}</section>`;
}

const chapters: { title: string; intro: string; guides: string[]; extra?: string }[] = [
  {
    title: "Administración",
    intro:
      "El administrador configura la plataforma y da acceso a los demás. Entra en " + APP_URL + "/login con su usuario y contraseña (o con su cuenta de Microsoft cuando esté conectada), elige el panel \"Administración\" y trabaja desde el menú por secciones: Resumen · Visitas (Invitar visitante, Aprobaciones, Visitantes frecuentes, Lista de evacuación) · Configuración (Sitios, Políticas de visita, Formularios, Política de visitantes) · Personas (Personas, Empresas, Lista negra) · Kioscos · Reportes · Ayuda. En esta guía las rutas se escriben así: Configuración → Sitios.\nOrden recomendado para dejar todo listo: (1) sitios con sus puertas y áreas, Wi-Fi de invitados y reglas de fotos y dispositivos; (2) políticas por tipo de visita; (3) política de visitantes (NDA) en español e inglés; (4) formularios de registro de RRHH; (5) personas: anfitriones, seguridad y sus accesos; (6) kioscos de recepción y puntos de control.",
    guides: ["admin-setup", "admin-people", "admin-forms", "reports"],
  },
  {
    title: "Anfitriones",
    intro:
      "El anfitrión es el empleado que recibe la visita. Entra en " + APP_URL + "/login con su correo y contraseña (se la asigna Administración en Personas → Editar) y llega al panel \"Anfitrión\": Mis visitas, Nuevo pase, Aprobaciones y, si es brigadista, Evacuación. Su trabajo es crear el pase o enlace de invitación, enviárselo al visitante, revisar lo que registró y aprobar cuando se le pida.",
    guides: ["host-passes", "approvals", "account"],
  },
  {
    title: "Seguridad y recepción",
    intro:
      "Seguridad trabaja desde la tablet o PC de recepción enrolada como kiosco (la dirección de Visitas seguida de /guard, o el enlace \"Abrir el modo kiosco\" al pie de la pantalla de inicio de sesión), que no usa correo ni contraseña: entra con el nombre del guardia y su PIN. La activación del equipo (código de enrolamiento, PIN, punto de control) es el primer apartado de este capítulo. En el kiosco se escanea el QR, se verifica lo que el sistema muestra (foto, cédula, dispositivos, áreas, avisos), se imprime el gafete, se registran las visitas no anunciadas y se marcan las salidas. Lo que no está registrado, no entra. Aprobar pases pendientes se hace desde el panel web (Aprobaciones), con cuenta, no desde el kiosco.",
    guides: ["kiosk-setup", "kiosk-daily", "evacuation"],
  },
];

const visitorChapter = () => `
<section class="guide">
<h2 id="visitante">4. Visitantes</h2>
<p class="summary">Lo que recibe el visitante, qué debe tener a mano para completar su registro y qué pasa cuando llega a la planta.</p>

<section class="step"><h3><span class="n">1</span>Recibes un enlace</h3>
<p>Tu anfitrión en Airlink te envía por WhatsApp o correo un enlace personal (empieza con ${esc(APP_URL)}/v/). Ese enlace es tu pase: lo abres en tu celular, completas tu registro y al terminar aparece tu código QR. No lo compartas: queda ligado a ti y cada persona del grupo tiene el suyo.</p>
${img("visitor-register", true)}
</section>

<section class="step"><h3><span class="n">2</span>Ten a mano antes de empezar</h3>
<ul>
<li>Tu cédula o pasaporte. Le tomas una foto por detrás (las tres líneas de letras y números) o a la página con foto del pasaporte, y el sistema lee tu nombre y tu número; esa foto solo se usa para leer los datos. Si no se lee bien, los escribes. Trae el documento físico el día de la visita.</li>
<li>Un celular con cámara, para la foto de tu cara y las de tu cédula cuando el sitio las pide (si tu enlace no muestra el bloque "Fotos obligatorias", ese sitio no las exige).</li>
<li>De cada dispositivo que traerás: <b>teléfono</b> (IMEI de 15 dígitos, que ves marcando *#06#; puedes escribirlo con espacios), modelo, color y capacidad; <b>laptop</b> (número de serie, modelo, color, disco SSD/HDD y RAM); <b>tablet</b>, <b>reloj inteligente</b> u <b>otro</b> (número de serie, modelo, color, capacidad). Lo que no registres no puede entrar.</li>
<li>Tu teléfono de contacto, correo, empresa y placa del vehículo si vienes en carro.</li>
<li>Para contratistas: la lista de herramientas y equipos que traes.</li>
</ul>
</section>

<section class="step"><h3><span class="n">3</span>Completa el formulario</h3>
<p>El formulario "Completa tu registro" va en este orden: primero "Escanear cédula o pasaporte" (o las fotos obligatorias), que llena por ti "Nombre completo" y "Cédula o pasaporte"; revisa que estén correctos. Luego teléfono, placa y empresa; las preguntas e instrucciones de tu tipo de visita (normas de planta, ruta de evacuación, herramientas); y al final "Dispositivos personales", donde agregas cada equipo con "Agregar otro dispositivo" o marcas "No traigo dispositivos". Pulsa "Completar registro".</p>
<p>Debajo hay un <b>segundo formulario</b>, "Política de visitantes", con su propio botón "Aceptar": léela, marca "He leído y acepto", escribe tu nombre como firma y pulsa Aceptar. Sin ese segundo paso el QR no aparece y Seguridad no te deja entrar. Hazlo aunque tu pase diga "Pendiente de aprobación".</p>
<p>Si el navegador marca un campo en rojo (IMEI incompleto, campo vacío), corrígelo antes de enviar: nada se pierde. Si te equivocaste de nombre o cédula después de completar el registro, no puedes corregirlo tú: tu anfitrión o Seguridad lo corrigen desde el pase. El formulario está en español e inglés: arriba a la derecha elige EN o ES y pulsa OK.</p>
</section>

<section class="step"><h3><span class="n">4</span>Qué ves en tu pase</h3>
<p>Al terminar aparece tu QR, el sitio, tu anfitrión, la vigencia (desde y hasta), las áreas autorizadas (y si debes ir acompañado), "Documento registrado (termina en …)", la lista de tus dispositivos, la fecha en que aceptaste la política y, si tu anfitrión lo compartió, la red Wi-Fi de invitados y su clave. El recuadro "A tu llegada" resume lo que te pedirán en recepción.</p>
<p>Si tu pase requiere aprobación verás "Pendiente de aprobación" y "Registro completado. Tu pase queda pendiente de aprobación": el QR aparece en este mismo enlace cuando lo aprueben; vuelve a abrirlo al llegar. Los pases recurrentes muestran un QR que cambia cada 30 segundos: ábrelo desde el enlace al llegar, no desde una captura de pantalla.</p>
${img("visitor-link", true)}
</section>

<section class="step"><h3><span class="n">5</span>A tu llegada</h3>
<ul>
<li>Preséntate en recepción con tu QR en el celular y tu cédula física. Seguridad escanea el QR y compara tu cara, tu cédula, tu placa y tus dispositivos con lo registrado; también ve tus respuestas (por ejemplo las herramientas que traes) y puede revisarlas.</li>
<li>Puedes llegar hasta una hora antes de la hora de tu pase (según lo configure cada sitio), nunca el día anterior. Si tu enlace dice "Este pase venció", pide a tu anfitrión que amplíe la vigencia: el mismo enlace vuelve a funcionar. Si dice "Cancelado", tu anfitrión anuló la visita: contáctalo antes de presentarte.</li>
<li>Recibes un gafete impreso con tu foto, nombre, empresa, anfitrión y áreas: llévalo visible todo el tiempo. Al entrar, tu enlace pasa a "Dentro de la planta": desde ese momento tu gafete es tu pase. En los puntos de control internos te lo escanean para verificar que puedes estar en esa área.</li>
<li>Si en recepción te dicen que faltan datos, dispositivos o fotos, abre tu enlace, complétalos y vuelve a mostrar el QR: aparece al instante.</li>
<li>Si vienes acompañado, cada persona necesita su propio pase; pídeselo a tu anfitrión antes de llegar.</li>
<li>Al salir, entrega el gafete en recepción: Seguridad registra tu salida.</li>
</ul>
</section>

<section class="step"><h3><span class="n">6</span>Qué está permitido y qué no</h3>
<p>Tu enlace lo resume en "A tu llegada"; las normas completas están en las instrucciones y la política de visitantes de tu tipo de visita, que lees y aceptas en el enlace. En general:</p>
<ul>
<li>Permitido: los dispositivos que registraste; conectarte al Wi-Fi de invitados si tu anfitrión lo compartió; circular por las áreas que indica tu pase, acompañado cuando el área lo exige.</li>
<li>No permitido: entrar sin pase, con el pase de otra persona o con dispositivos no registrados; fotografiar o grabar líneas de producción sin autorización; entrar a áreas que no están en tu pase; permanecer después de la hora de tu pase sin que tu anfitrión la amplíe.</li>
<li>Tus datos se usan solo para el control de acceso; la cédula se guarda de forma parcial y las fotos se eliminan automáticamente pasado el plazo de retención del sitio.</li>
</ul>
</section>
</section>`;

const faq = `
<section class="guide">
<h2 id="faq">5. Preguntas frecuentes</h2>
<dl>
<dt>Un empleado no ve el panel de Anfitrión.</dt><dd>Toda persona activa con cuenta lo recibe al entrar. Si no aparece, en Personas revisa que esté activa, tenga correo y contraseña (Editar → Guardar contraseña).</dd>
<dt>Olvidé la contraseña de un usuario.</dt><dd>Administración → Personas → Editar → Contraseña: escribe una nueva y entrégala en persona. Si el usuario perdió el autenticador, marca "Reiniciar la verificación en dos pasos".</dd>
<dt>El kiosco solo me deja un sitio.</dt><dd>Cada tablet queda enrolada para un sitio y una puerta. En la pantalla del PIN pulsa "Cambiar de dispositivo", crea un dispositivo para el sitio correcto en Dispositivos de kiosco y enrola con el código nuevo.</dd>
<dt>El visitante llegó temprano o tarde.</dt><dd>Temprano: entra hasta los "Minutos de llegada anticipada" del sitio (60 por defecto). Tarde: el anfitrión abre el pase y usa "Cambiar vigencia"; el QR sigue siendo el mismo.</dd>
<dt>El kiosco dice "Faltan fotos" o "Debe registrar sus dispositivos".</dt><dd>El visitante abre su enlace y completa lo que falta; el QR vuelve a funcionar al instante. Si lo llenó mal, el anfitrión, RRHH o Seguridad lo corrigen desde el pase (Reportes → Invitaciones → Ver).</dd>
<dt>Llegó alguien sin invitación.</dt><dd>Si el sitio permite "Visita no anunciada", recepción la registra y el anfitrión aprueba desde su panel o en persona. Si está desactivada, un anfitrión (o Seguridad/Administración en su nombre) le crea un pase en el momento.</dd>
<dt>¿Dónde queda todo registrado?</dt><dd>Reportes → Visitas, Auditoría (quién entró, con quién, qué aceptó, quién aprobó, puntos de control), Bitácora de turno e Invitaciones. Todo exportable a CSV.</dd>
</dl>
<p class="muted">Guía generada automáticamente desde la ayuda de la aplicación (${esc(APP_URL)}/help), que siempre tiene la versión más reciente.</p>
</section>`;

function toc(): string {
  let n = 0;
  const items: string[] = [];
  for (const ch of chapters) {
    n += 1;
    items.push(`<li><b>${n}. ${esc(ch.title)}</b><ul>${ch.guides.map((g, i) => `<li><a href="#${g}">${n}.${i + 1} ${esc(messages.help.guides[g]!.title)}</a></li>`).join("")}</ul></li>`);
  }
  items.push(`<li><b>4. Visitantes</b></li><li><b>5. Preguntas frecuentes</b></li>`);
  return `<ul class="toc">${items.join("")}</ul>`;
}

function body(): string {
  const parts: string[] = [];
  chapters.forEach((ch, ci) => {
    parts.push(`<section class="chapter"><h1>${ci + 1}. ${esc(ch.title)}</h1>${paras(ch.intro)}</section>`);
    ch.guides.forEach((g, gi) => parts.push(guideHtml(g, `${ci + 1}.${gi + 1}`, gi === 0)));
  });
  parts.push(visitorChapter(), faq);
  return parts.join("\n");
}

const logo = readFileSync(join(ROOT, "public", "icons", "icon.svg")).toString("base64");
const today = new Date().toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "long" });

const buildHtml = () => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Airlink Visitas · Guía de uso</title>
<style>
  @page { size: Letter; margin: 18mm 16mm 20mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; font-size: 10.5pt; line-height: 1.45; }
  .cover { height: 90vh; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .cover img { width: 120px; margin-bottom: 24px; }
  .cover h1 { font-size: 30pt; margin: 0 0 8px; }
  .cover p { font-size: 13pt; color: #444; margin: 2px 0; }
  .toc { page-break-after: always; font-size: 11pt; list-style: none; padding-left: 0; } .toc ul { list-style: none; padding-left: 14px; } .toc li { margin: 3px 0; } .toc a { color: #111; text-decoration: none; }
  .chapter { page-break-before: always; }
  .chapter h1 { font-size: 22pt; border-bottom: 3px solid #d7191c; padding-bottom: 6px; margin: 0 0 10px; }
  .guide { page-break-before: always; } .guide.first { page-break-before: auto; margin-top: 18px; }
  .guide h2 { font-size: 16pt; margin: 0 0 4px; color: #111; }
  .summary { color: #555; margin: 0 0 12px; }
  .step { margin: 0 0 14px; } .step h3 { page-break-after: avoid; } .step p, .step ul { page-break-inside: avoid; }
  .step h3 { font-size: 12pt; margin: 10px 0 4px; display: flex; align-items: center; gap: 8px; }
  .n { display: inline-flex; width: 22px; height: 22px; border-radius: 50%; background: #d7191c; color: #fff; align-items: center; justify-content: center; font-size: 10pt; }
  p { margin: 4px 0; } ul { margin: 4px 0 4px 18px; padding: 0; } li { margin: 2px 0; }
  figure { margin: 8px 0 0; page-break-inside: avoid; } figure img { display: block; max-width: 100%; max-height: 200mm; width: auto; border: 1px solid #ddd; border-radius: 6px; } figure.kiosk img { max-width: 70%; }
  figure.tall { page-break-inside: auto; } figure.tall img { max-height: none; width: 62%; border: 0; border-radius: 0; margin: 0; page-break-inside: avoid; }
  dl dt { font-weight: 600; margin-top: 8px; } dl dd { margin: 2px 0 0 0; }
  .muted { color: #666; font-size: 9pt; margin-top: 16px; }
</style></head><body>
<section class="cover"><img src="data:image/svg+xml;base64,${logo}" alt="" /><h1>Airlink Visitas</h1><p>Guía de uso completa: administración, anfitriones, seguridad y visitantes</p><p>${esc(APP_URL)}</p><p>${esc(today)}</p></section>
<h1>Contenido</h1>${toc()}
${body()}
</body></html>`;

async function main() {
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  await renderShots();
  await page.setContent(buildHtml(), { waitUntil: "load" });
  const pdf = await page.pdf({ format: "Letter", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: '<div style="font-size:8pt;color:#666;width:100%;text-align:center;">Airlink Visitas · Guía de uso · página <span class="pageNumber"></span> de <span class="totalPages"></span></div>', margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" } });
  await browser.close();
  writeFileSync(OUT, pdf);
  console.log(`[help] ${OUT} (${(pdf.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
