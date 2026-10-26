export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold">Sin conexión</h1>
      <p className="muted mt-2">No hay red en este momento. Vuelve a intentarlo cuando se restablezca.</p>
    </main>
  );
}
