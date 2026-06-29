# Desplegar Mata AI gratis en Oracle Cloud (Always Free)

Objetivo: backend + Postgres + Redis corriendo 24/7 **gratis** en una VM de Oracle,
con HTTPS automático (Caddy). El frontend se queda en Firebase Hosting (gratis).

Resultado final:
- Frontend: `https://mata-ai-236ad.web.app` (Firebase)
- Backend:  `https://TU-DOMINIO` (VM de Oracle, con SSL)

---

## 1. Crear cuenta en Oracle Cloud

1. Entra a https://www.oracle.com/cloud/free/ → **Start for free**.
2. Regístrate (pide tarjeta para verificar identidad, **no cobra**; elige cuenta "Always Free").
3. Elige una **región** cercana. (Truco: si más tarde no hay capacidad ARM, prueba otra región.)

## 2. Crear la VM gratis (ARM Ampere A1)

1. Menú ☰ → **Compute → Instances → Create instance**.
2. **Image**: Canonical **Ubuntu 22.04**.
3. **Shape**: cambia a **Ampere (ARM)** → `VM.Standard.A1.Flex` → **4 OCPU, 24 GB RAM** (todo gratis).
   - Si dice "out of capacity", reintenta más tarde o cambia de región/Availability Domain.
4. **Networking**: deja crear una VCP nueva, marca **Assign a public IPv4 address**.
5. **SSH keys**: descarga la clave privada (la usarás para conectarte). Guárdala bien.
6. **Create**. Anota la **IP pública** cuando esté "Running".

## 3. Abrir los puertos 80 y 443

Hay que abrirlos en DOS sitios:

**a) Security List (firewall de Oracle):**
1. Instance → Virtual Cloud Network → **Security Lists** → Default.
2. **Add Ingress Rules** (una por puerto): Source `0.0.0.0/0`, IP Protocol TCP,
   Destination Port `80`, y otra para `443`.

**b) Firewall del sistema (dentro de la VM, tras conectarte en el paso 4):**
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 4. Conectarte por SSH

Desde tu PC (PowerShell), con la clave descargada:
```bash
ssh -i C:\ruta\a\tu-clave.key ubuntu@TU-IP-PUBLICA
```

## 5. Instalar Docker y Git

```bash
sudo apt update && sudo apt install -y git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
# cierra sesión y vuelve a entrar (exit y ssh otra vez) para aplicar el grupo docker
```

## 6. Dominio gratis con DuckDNS (para el HTTPS)

Caddy necesita un dominio que apunte a tu IP.
1. Entra a https://www.duckdns.org → inicia sesión (Google/GitHub).
2. Crea un subdominio, p.ej. `mata-ai` → te queda `mata-ai.duckdns.org`.
3. En el campo **current ip** pon la **IP pública** de tu VM → **update**.

> ¿Tienes dominio propio? Mejor aún: crea un registro **A** que apunte a la IP de la VM.

## 7. Clonar el repo y configurar el .env

```bash
git clone TU-REPO-GIT mata-ai && cd mata-ai
cp .env.prod.example .env
nano .env
```
Rellena como mínimo: `DOMAIN` (tu duckdns), `POSTGRES_PASSWORD`, `JWT_SECRET`,
`SEED_ADMIN_EMAIL/PASSWORD`, `NVIDIA_API_KEY`, `GROQ_API_KEY` (gratis en
https://console.groq.com), y `CORS_ORIGINS` con la URL de Firebase.

## 8. Levantar todo

```bash
docker compose -f docker-compose.prod.yml up -d --build
```
Espera 1-2 min. Comprueba:
```bash
docker compose -f docker-compose.prod.yml ps
curl https://TU-DOMINIO/healthz       # debe responder {"status":"ok"...}
```
Caddy saca el certificado SSL solo la primera vez (puede tardar ~1 min).

## 9. Apuntar el frontend (Firebase) al nuevo backend

En tu PC, reconstruye el frontend apuntando al backend de Oracle y vuelve a desplegar:
```bash
cd frontend
# build con la URL del backend (PowerShell):
$env:NEXT_PUBLIC_API_URL="https://TU-DOMINIO"; npm run build
firebase deploy --only hosting
```
(El frontend ya está configurado para Firebase; solo cambia la URL del API.)

## 10. Probar

1. Abre `https://mata-ai-236ad.web.app`.
2. Regístrate / inicia sesión.
3. Prueba **Chat**, **Studio** y el nuevo módulo **Clips** (pega un link o sube un video).

---

## Mantenimiento

- Ver logs:        `docker compose -f docker-compose.prod.yml logs -f backend`
- Actualizar:      `git pull && docker compose -f docker-compose.prod.yml up -d --build`
- Reiniciar:       `docker compose -f docker-compose.prod.yml restart`
- Backup de la DB: `docker compose -f docker-compose.prod.yml exec db pg_dump -U mata mata > backup.sql`

## Notas

- **Todo gratis y 24/7**: la VM Always Free no caduca. 24 GB de RAM sobran para
  procesar video (Clips/Studio).
- **DuckDNS + IP**: si Oracle te cambia la IP (raro con IP reservada), actualízala en DuckDNS.
- **Seguridad**: cambia las contraseñas por defecto y mantén el sistema actualizado
  (`sudo apt upgrade`).
