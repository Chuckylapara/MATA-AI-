FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# SERVICE + PORT are injected per container by docker-compose.
ENV SERVICE=gateway PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn run:app --host 0.0.0.0 --port ${PORT}"]
