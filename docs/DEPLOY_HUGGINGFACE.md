# Desplegar el backend de Mata AI en Hugging Face Spaces (gratis, sin tarjeta)

El frontend ya está en Firebase. Esto pone el **backend** (API + Clips) en un Space
gratuito de Hugging Face: 16 GB de RAM, sin tarjeta, HTTPS automático.

## 1. Crear la cuenta (solo correo, sin tarjeta)

1. Entra a https://huggingface.co/join → regístrate con tu correo o con GitHub.
2. Verifica el correo.

## 2. Crear el Space

1. Ve a https://huggingface.co/new-space
2. **Owner**: tu usuario. **Space name**: `mata-ai-backend`.
3. **License**: la que quieras (p.ej. MIT).
4. **SDK**: elige **Docker** → plantilla **Blank**.
5. **Hardware**: deja **CPU basic (free)**.
6. **Visibility**: Public.
7. **Create Space**.

## 3. Subir los 2 archivos de configuración

En la pestaña **Files** del Space → **Add file → Upload files**, sube estos dos
(están en este repo, carpeta `huggingface-space/`):

- `Dockerfile`
- `README.md`

> Sube el **contenido** de esos archivos a la raíz del Space (no la carpeta).
> Puedes copiar/pegar su contenido con "Create new file" si prefieres.

## 4. Poner las claves (Secrets)

En el Space → **Settings → Variables and secrets → New secret**, añade:

| Nombre | Valor |
|---|---|
| `NVIDIA_API_KEY` | tu clave de NVIDIA |
| `GROQ_API_KEY` | tu clave de Groq |
| `JWT_SECRET` | una cadena larga aleatoria |
| `SEED_ADMIN_EMAIL` | tu correo de admin |
| `SEED_ADMIN_PASSWORD` | una contraseña fuerte |
| `CORS_ORIGINS` | `https://mata-ai-236ad.web.app` |
| `GEMINI_API_KEY` | (opcional) |
| `KIE_API_KEY` | (opcional, imágenes/música) |

Tras añadir los secrets, el Space se reconstruye solo. Espera a que diga **Running**.

## 5. Copiar la URL del backend

La URL del Space es del tipo:

    https://TU-USUARIO-mata-ai-backend.hf.space

Compruébala abriendo `https://TU-USUARIO-mata-ai-backend.hf.space/healthz`
→ debe responder `{"status":"ok",...}`.

## 6. Apuntar el frontend a ese backend

Pásame la URL del Space y yo reconstruyo el frontend y lo vuelvo a publicar en
Firebase apuntando ahí (o hazlo tú):

```powershell
cd frontend
$env:NEXT_PUBLIC_API_URL="https://TU-USUARIO-mata-ai-backend.hf.space"; npm run build
firebase deploy --only hosting
```

## 7. Listo

Abre https://mata-ai-236ad.web.app, regístrate y prueba **Clips**.

---

## Notas

- **Datos efímeros**: con SQLite, los usuarios/créditos se reinician si el Space se
  reconstruye. Cuando quieras datos permanentes (gratis, sin tarjeta), crea un
  Postgres en **Neon** (https://neon.tech, solo correo) y añade su cadena como secret
  `DATABASE_URL` (formato `postgresql+asyncpg://...`).
- **Se duerme** tras 48 h sin uso y despierta al primer visitante (arranque en frío).
- **Actualizar el código**: Settings → **Factory rebuild** (vuelve a clonar de GitHub).
