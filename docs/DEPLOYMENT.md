# Desplegar Mata AI en internet (link público)

Arquitectura del despliegue:

```
Usuarios ─► Vercel (frontend Next.js) ─► Render (backend FastAPI) ─► Gemini / Pollinations
```

Ambos tienen **plan gratuito**. Necesitas: una cuenta de **GitHub**, una de **Render** y una de **Vercel** (puedes entrar con GitHub).

---

## Paso 0 — Subir el código a GitHub

```bash
cd "C:\Users\lacur\Desktop\drew ai"
git init
git add .
git commit -m "Mata AI"
# crea un repo vacío en github.com y luego:
git remote add origin https://github.com/TU_USUARIO/mata-ai.git
git branch -M main
git push -u origin main
```

> El archivo `.gitignore` ya evita subir `.env` y `node_modules`. **Tu API key NO se sube** (está en `backend/.env`, ignorado).

---

## Paso 1 — Backend en Render

1. Entra a **https://render.com** → **New** → **Blueprint**.
2. Conecta tu repo de GitHub. Render detecta `render.yaml` automáticamente.
3. Antes de crear, te pedirá las variables marcadas como secretas:
   - `GEMINI_API_KEY` → tu clave de Gemini.
   - `CORS_ORIGINS` → de momento pon `*` (luego lo afinas al dominio de Vercel).
4. Crea el servicio. En unos minutos tendrás una URL tipo:
   `https://mata-ai-backend.onrender.com`
5. Verifícalo abriendo `https://mata-ai-backend.onrender.com/healthz`

> **Nota:** el plan free de Render **se duerme** tras inactividad (primer request tarda ~30s) y usa SQLite **efímero** (los datos se reinician al redeploy). Para datos persistentes, crea un **PostgreSQL free** en Render y cambia `DATABASE_URL` a la cadena `postgresql+asyncpg://...` que te da Render (quita `DEV_INMEMORY` y añade un Redis si quieres colas reales).

---

## Paso 2 — Frontend en Vercel

1. Entra a **https://vercel.com** → **Add New** → **Project** → importa el repo.
2. En **Root Directory** elige **`frontend`**.
3. En **Environment Variables** añade:
   - `NEXT_PUBLIC_API_URL` = `https://mata-ai-backend.onrender.com` (tu URL de Render)
4. **Deploy**. Obtendrás tu link público, p. ej.:
   `https://mata-ai.vercel.app`

---

## Paso 3 — Conectar CORS

1. Vuelve a Render → tu servicio → **Environment**.
2. Cambia `CORS_ORIGINS` a tu dominio de Vercel exacto:
   `https://mata-ai.vercel.app`
3. Guarda (Render redepliega solo).

¡Listo! Comparte **https://mata-ai.vercel.app** — cualquiera puede entrar desde su celular o PC.

---

## Recomendaciones de producción

- **Seguridad de Next.js:** antes de producción, actualiza Next a la última versión parcheada de la línea 14.2:
  `cd frontend && npm i next@latest` (revisa que siga en 14.x o migra a 15 con pruebas).
- **Rota tu API key** de Gemini (la que se usó en desarrollo).
- **Persistencia:** usa PostgreSQL gestionado en vez de SQLite.
- **Voz:** el reconocimiento de voz del navegador requiere **HTTPS** — Vercel ya sirve por HTTPS, así que el avatar en vivo funcionará en el sitio público.
- **Microservicios reales:** para escalar, usa `docker-compose.yml` (Postgres + Redis + servicios separados) en un host con Docker en lugar del modo `devserver`.
