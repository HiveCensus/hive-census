
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Pierwszy test działania kodu Workera.
    if (url.pathname === "/api/status") {
      return Response.json({
        ok: true,
        service: "Hive Census",
        version: "0.6.0",
        message: "Hive Census Worker is running"
      });
    }

    // Wszystkie pozostałe żądania obsługuje
    // dotychczasowa strona z katalogu /public.
    return env.ASSETS.fetch(request);
  }
};
