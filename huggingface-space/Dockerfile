# Dockerfile para Hugging Face Spaces (SDK: docker).
# Clona el backend de Mata AI desde GitHub y lo corre todo-en-uno en el puerto 7860.
# Las claves (NVIDIA, GROQ, etc.) se inyectan como secrets del Space en runtime.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

# ffmpeg: video (Studio + Clips). libglib2.0-0: OpenCV headless. git: para clonar.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ffmpeg libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clona el repo público y instala las dependencias del backend.
# (Para actualizar a la última versión: Settings → Factory rebuild en el Space.)
RUN git clone --depth 1 https://github.com/Chuckylapara/MATA-AI-.git repo
RUN pip install --no-cache-dir -r repo/backend/requirements.txt

WORKDIR /app/repo/backend

# Carpetas de salida con permiso de escritura (almacenamiento efímero del Space).
RUN mkdir -p _renders _clips && chmod -R 777 _renders _clips

# Todo-en-uno; SQLite local por defecto (efímero). Para datos persistentes,
# define DATABASE_URL en los secrets con un Postgres gratis (Neon/Supabase).
ENV SERVICE=devserver \
    PORT=7860 \
    DEV_INMEMORY=1 \
    DATABASE_URL=sqlite+aiosqlite:///./mata.db

EXPOSE 7860

CMD ["sh", "-c", "uvicorn run:app --host 0.0.0.0 --port 7860"]
