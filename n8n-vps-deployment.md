# Complete n8n Production Deployment on VPS with Docker

This guide provides step-by-step instructions to deploy a production-ready n8n instance on a VPS using Docker, PostgreSQL 16, Redis queue mode, and Traefik reverse proxy with automatic SSL. After following this documentation, you will have n8n accessible at `https://n8n.tuhhuevoh.com` with full queue mode capabilities, automated backups, and enterprise-grade security.

**Target Environment:**
- **VPS IP:** 51.178.50.194
- **RAM:** 12GB
- **Bandwidth:** 1000Mbps
- **OS:** Ubuntu 25.10
- **Domain:** n8n.tuhhuevoh.com

---

## 1. Prerequisites and Initial VPS Access

### 1.1 Initial SSH Connection

Connect to your VPS using the root credentials provided by your hosting provider:

```bash
ssh root@51.178.50.194
```

### 1.2 Create a Non-Root User

Creating a dedicated user for deployment is a critical security practice. Never run services as root.

```bash
# Create deploy user
adduser deploy

# Add to sudo group
usermod -aG sudo deploy

# Verify the user was created correctly
groups deploy
```

When prompted, set a strong password and fill in the optional user information.

### 1.3 Set Up SSH Key Authentication

On your **local machine**, generate an SSH key pair if you don't have one:

```bash
# Generate ED25519 key (recommended)
ssh-keygen -t ed25519 -C "your_email@example.com"

# Copy public key to server
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@51.178.50.194
```

Alternatively, manually add your public key on the server:

```bash
# On the server, as root or deploy user
su - deploy
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo "your_public_key_content_here" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 1.4 Test Non-Root Login

Before proceeding, verify you can log in as the deploy user:

```bash
ssh deploy@51.178.50.194
```

---

## 2. System Preparation

### 2.1 Update System Packages

```bash
sudo apt update && sudo apt upgrade -y
```

### 2.2 Install Essential Packages

```bash
sudo apt install -y \
    curl \
    wget \
    git \
    vim \
    htop \
    net-tools \
    unzip \
    software-properties-common \
    ca-certificates \
    gnupg \
    lsb-release \
    apache2-utils
```

### 2.3 Set Timezone to Europe/Madrid

```bash
sudo timedatectl set-timezone Europe/Madrid

# Verify
timedatectl
```

### 2.4 Configure Automatic Security Updates

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### 2.5 Install Docker and Docker Compose

Remove any existing Docker packages that might conflict:

```bash
sudo apt remove docker docker-engine docker.io containerd runc 2>/dev/null || true
```

Install Docker from the official repository:

```bash
# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update and install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Add your user to the Docker group:

```bash
sudo usermod -aG docker $USER

# Apply group changes (or logout/login)
newgrp docker
```

Verify the installation:

```bash
docker --version
docker compose version
sudo docker run hello-world
```

### 2.6 Configure Docker Daemon for Production

Create the Docker daemon configuration file:

```bash
sudo nano /etc/docker/daemon.json
```

Add the following configuration:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "live-restore": true
}
```

Restart Docker to apply changes:

```bash
sudo systemctl restart docker
sudo systemctl enable docker
```

---

## 3. Cloudflare DNS Configuration

### 3.1 Log in to Cloudflare Dashboard

Navigate to [dash.cloudflare.com](https://dash.cloudflare.com) and select your domain `tuhhuevoh.com`.

### 3.2 Create DNS A Record

Go to **DNS** → **Records** and click **Add record**:

| Setting | Value |
|---------|-------|
| **Type** | A |
| **Name** | n8n |
| **IPv4 address** | 51.178.50.194 |
| **Proxy status** | DNS only (gray cloud) |
| **TTL** | Auto |

**Important:** Set proxy status to **DNS only** (gray cloud icon) initially. This allows Let's Encrypt to properly validate your domain via HTTP challenge. You can enable the Cloudflare proxy later if desired.

### 3.3 Create Cloudflare API Token (For DNS Challenge - Optional)

If you prefer DNS challenge for SSL certificates, create an API token:

1. Go to **My Profile** → **API Tokens**
2. Click **Create Token**
3. Use **Edit zone DNS** template
4. Configure:
   - **Zone Resources:** Include → Specific zone → tuhhuevoh.com
   - **Permissions:** Zone:DNS:Edit, Zone:Zone:Read
5. Click **Continue to summary** → **Create Token**
6. **Save the token securely** - you'll need it later

### 3.4 Verify DNS Propagation

Wait a few minutes and verify the DNS record is active:

```bash
# From any machine
dig n8n.tuhhuevoh.com +short
# Should return: 51.178.50.194

# Or using nslookup
nslookup n8n.tuhhuevoh.com
```

---

## 4. Directory Structure Creation

### 4.1 Create Application Directory Structure

```bash
# Create main application directory
sudo mkdir -p /opt/n8n
sudo chown -R $USER:$USER /opt/n8n
cd /opt/n8n

# Create subdirectories
mkdir -p \
    traefik/config \
    traefik/logs \
    postgres \
    redis \
    n8n-data \
    backups/postgres \
    backups/volumes \
    scripts
```

### 4.2 Create Required Files

```bash
# Create empty acme.json with correct permissions (critical for Let's Encrypt)
touch /opt/n8n/traefik/acme.json
chmod 600 /opt/n8n/traefik/acme.json
```

The final directory structure will be:

```
/opt/n8n/
├── docker-compose.yml
├── .env
├── traefik/
│   ├── traefik.yml
│   ├── config/
│   │   └── dynamic.yml
│   ├── logs/
│   └── acme.json
├── postgres/
├── redis/
├── n8n-data/
├── backups/
│   ├── postgres/
│   └── volumes/
└── scripts/
    ├── backup-postgres.sh
    └── backup-all.sh
```

---

## 5. Docker Compose Configuration

### 5.1 Create the Main Docker Compose File

Create the main Docker Compose file with all services:

```bash
nano /opt/n8n/docker-compose.yml
```

Add the following complete configuration:

```yaml
version: "3.9"

services:
  # ===========================================
  # TRAEFIK - Reverse Proxy & SSL Termination
  # ===========================================
  traefik:
    image: traefik:v3.2
    container_name: traefik
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    ports:
      - "80:80"
      - "443:443"
    environment:
      - TZ=Europe/Madrid
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik/traefik.yml:/traefik.yml:ro
      - ./traefik/config:/config:ro
      - ./traefik/acme.json:/acme.json
      - ./traefik/logs:/var/log/traefik
    networks:
      - n8n-network
    labels:
      - "traefik.enable=true"
      # HTTP to HTTPS redirect
      - "traefik.http.routers.traefik-http.entrypoints=web"
      - "traefik.http.routers.traefik-http.rule=Host(`traefik.n8n.tuhhuevoh.com`)"
      - "traefik.http.routers.traefik-http.middlewares=https-redirect"
      - "traefik.http.middlewares.https-redirect.redirectscheme.scheme=https"
      - "traefik.http.middlewares.https-redirect.redirectscheme.permanent=true"
    healthcheck:
      test: ["CMD", "traefik", "healthcheck", "--ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 256M

  # ===========================================
  # POSTGRESQL 16 - Primary Database
  # ===========================================
  postgres:
    image: postgres:16-alpine
    container_name: n8n-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      TZ: Europe/Madrid
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups/postgres:/backups
    command:
      - "postgres"
      - "-c"
      - "shared_buffers=1024MB"
      - "-c"
      - "effective_cache_size=3072MB"
      - "-c"
      - "maintenance_work_mem=256MB"
      - "-c"
      - "checkpoint_completion_target=0.9"
      - "-c"
      - "wal_buffers=16MB"
      - "-c"
      - "default_statistics_target=100"
      - "-c"
      - "random_page_cost=1.1"
      - "-c"
      - "effective_io_concurrency=200"
      - "-c"
      - "work_mem=4MB"
      - "-c"
      - "min_wal_size=1GB"
      - "-c"
      - "max_wal_size=4GB"
      - "-c"
      - "max_connections=100"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - n8n-network
    deploy:
      resources:
        limits:
          memory: 4G

  # ===========================================
  # REDIS - Queue Broker for n8n
  # ===========================================
  redis:
    image: redis:7-alpine
    container_name: n8n-redis
    restart: unless-stopped
    command: >
      redis-server
      --maxmemory 512mb
      --maxmemory-policy noeviction
      --appendonly yes
      --appendfsync everysec
      --save 900 1
      --save 300 10
      --save 60 10000
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    networks:
      - n8n-network
    deploy:
      resources:
        limits:
          memory: 1G

  # ===========================================
  # N8N - Main Application (Editor/Webhook)
  # ===========================================
  n8n:
    image: n8nio/n8n:latest
    container_name: n8n
    restart: unless-stopped
    environment:
      # Database Configuration
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=${POSTGRES_DB}
      - DB_POSTGRESDB_USER=${POSTGRES_USER}
      - DB_POSTGRESDB_PASSWORD=${POSTGRES_PASSWORD}
      - DB_POSTGRESDB_POOL_SIZE=10
      # Queue Mode Configuration
      - EXECUTIONS_MODE=queue
      - QUEUE_BULL_REDIS_HOST=redis
      - QUEUE_BULL_REDIS_PORT=6379
      - QUEUE_BULL_REDIS_DB=0
      - QUEUE_HEALTH_CHECK_ACTIVE=true
      # Instance Configuration
      - N8N_HOST=n8n.tuhhuevoh.com
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://n8n.tuhhuevoh.com/
      - N8N_EDITOR_BASE_URL=https://n8n.tuhhuevoh.com/
      # Security
      - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
      # Timezone
      - GENERIC_TIMEZONE=Europe/Madrid
      - TZ=Europe/Madrid
      # Execution Data Management
      - EXECUTIONS_DATA_PRUNE=true
      - EXECUTIONS_DATA_MAX_AGE=168
      - EXECUTIONS_DATA_PRUNE_MAX_COUNT=50000
      - EXECUTIONS_DATA_SAVE_ON_ERROR=all
      - EXECUTIONS_DATA_SAVE_ON_SUCCESS=all
      - EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=true
      # Performance
      - N8N_PAYLOAD_SIZE_MAX=64
      - N8N_METRICS=true
      # Logging
      - N8N_LOG_LEVEL=info
      - N8N_LOG_OUTPUT=console
    volumes:
      - n8n_data:/home/node/.n8n
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - n8n-network
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=n8n-network"
      # HTTP Router (redirect to HTTPS)
      - "traefik.http.routers.n8n-http.entrypoints=web"
      - "traefik.http.routers.n8n-http.rule=Host(`n8n.tuhhuevoh.com`)"
      - "traefik.http.routers.n8n-http.middlewares=https-redirect"
      # HTTPS Router
      - "traefik.http.routers.n8n.entrypoints=websecure"
      - "traefik.http.routers.n8n.rule=Host(`n8n.tuhhuevoh.com`)"
      - "traefik.http.routers.n8n.tls=true"
      - "traefik.http.routers.n8n.tls.certresolver=letsencrypt"
      - "traefik.http.routers.n8n.middlewares=n8n-headers"
      # Service
      - "traefik.http.services.n8n.loadbalancer.server.port=5678"
      # Security Headers Middleware
      - "traefik.http.middlewares.n8n-headers.headers.browserXssFilter=true"
      - "traefik.http.middlewares.n8n-headers.headers.contentTypeNosniff=true"
      - "traefik.http.middlewares.n8n-headers.headers.frameDeny=true"
      - "traefik.http.middlewares.n8n-headers.headers.stsSeconds=31536000"
      - "traefik.http.middlewares.n8n-headers.headers.stsIncludeSubdomains=true"
      - "traefik.http.middlewares.n8n-headers.headers.stsPreload=true"
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q http://localhost:5678/healthz || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    deploy:
      resources:
        limits:
          memory: 2G

  # ===========================================
  # N8N WORKER - Queue Mode Execution Worker
  # ===========================================
  n8n-worker:
    image: n8nio/n8n:latest
    container_name: n8n-worker
    restart: unless-stopped
    command: worker
    environment:
      # Database Configuration (must match main n8n)
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=${POSTGRES_DB}
      - DB_POSTGRESDB_USER=${POSTGRES_USER}
      - DB_POSTGRESDB_PASSWORD=${POSTGRES_PASSWORD}
      - DB_POSTGRESDB_POOL_SIZE=10
      # Queue Mode Configuration
      - EXECUTIONS_MODE=queue
      - QUEUE_BULL_REDIS_HOST=redis
      - QUEUE_BULL_REDIS_PORT=6379
      - QUEUE_BULL_REDIS_DB=0
      # Security (MUST be same as main n8n)
      - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
      # Timezone
      - GENERIC_TIMEZONE=Europe/Madrid
      - TZ=Europe/Madrid
      # Logging
      - N8N_LOG_LEVEL=info
      - N8N_LOG_OUTPUT=console
    volumes:
      - n8n_data:/home/node/.n8n
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      n8n:
        condition: service_healthy
    networks:
      - n8n-network
    deploy:
      resources:
        limits:
          memory: 2G

# ===========================================
# VOLUMES
# ===========================================
volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local
  n8n_data:
    driver: local

# ===========================================
# NETWORKS
# ===========================================
networks:
  n8n-network:
    driver: bridge
    name: n8n-network
```

---

## 6. Environment Variables and Secrets Configuration

### 6.1 Generate Secure Secrets

Generate strong passwords and encryption keys:

```bash
# Generate PostgreSQL password (32 characters)
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
echo "POSTGRES_PASSWORD: $POSTGRES_PASSWORD"

# Generate n8n encryption key (32 characters)
N8N_ENCRYPTION_KEY=$(openssl rand -hex 16)
echo "N8N_ENCRYPTION_KEY: $N8N_ENCRYPTION_KEY"
```

**Critical:** Save these values securely. The `N8N_ENCRYPTION_KEY` is used to encrypt credentials stored in n8n. If lost, you will not be able to recover encrypted credentials.

### 6.2 Create Environment File

```bash
nano /opt/n8n/.env
```

Add the following content (replace with your generated values):

```bash
# ===========================================
# n8n Production Environment Configuration
# ===========================================

# PostgreSQL Configuration
POSTGRES_USER=n8n
POSTGRES_PASSWORD=your_generated_postgres_password_here
POSTGRES_DB=n8n

# n8n Encryption Key (CRITICAL - BACKUP THIS VALUE!)
# Used to encrypt stored credentials - cannot be recovered if lost
N8N_ENCRYPTION_KEY=your_generated_encryption_key_here

# Domain Configuration
DOMAIN=n8n.tuhhuevoh.com

# Let's Encrypt Email (for SSL certificate notifications)
LETSENCRYPT_EMAIL=your_email@example.com

# Optional: Cloudflare API Token (if using DNS challenge)
# CF_DNS_API_TOKEN=your_cloudflare_api_token_here
```

### 6.3 Secure the Environment File

```bash
chmod 600 /opt/n8n/.env
```

### 6.4 Backup Your Secrets

Create a secure backup of your secrets:

```bash
# Create encrypted backup
mkdir -p ~/secrets-backup
cp /opt/n8n/.env ~/secrets-backup/.env.backup
chmod 600 ~/secrets-backup/.env.backup

# Optionally encrypt with gpg
# gpg -c ~/secrets-backup/.env.backup
```

**Warning:** Store a copy of your `.env` file and especially the `N8N_ENCRYPTION_KEY` in a secure location outside the server (password manager, encrypted cloud storage, etc.).

---

## 7. Traefik Configuration for HTTPS/SSL

### 7.1 Create Traefik Static Configuration

```bash
nano /opt/n8n/traefik/traefik.yml
```

Add the following configuration:

```yaml
# ===========================================
# Traefik v3 Static Configuration
# ===========================================

api:
  dashboard: false  # Disable dashboard in production for security
  debug: false

# Entry Points Definition
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":443"
    http:
      tls:
        certResolver: letsencrypt

# Docker Provider Configuration
providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: n8n-network
    watch: true
  file:
    directory: /config
    watch: true

# Let's Encrypt Certificate Resolver
certificatesResolvers:
  letsencrypt:
    acme:
      email: your_email@example.com  # Change this!
      storage: /acme.json
      caServer: https://acme-v02.api.letsencrypt.org/directory
      httpChallenge:
        entryPoint: web

# Logging Configuration
log:
  level: INFO
  # filePath: /var/log/traefik/traefik.log
  # format: json

accessLog:
  filePath: /var/log/traefik/access.log
  format: json
  bufferingSize: 100
  filters:
    statusCodes:
      - "400-599"

# Ping/Health Check
ping:
  entryPoint: web
```

**Important:** Replace `your_email@example.com` with your actual email address for Let's Encrypt notifications.

### 7.2 Create Dynamic Configuration File

```bash
nano /opt/n8n/traefik/config/dynamic.yml
```

Add the following:

```yaml
# ===========================================
# Traefik Dynamic Configuration
# ===========================================

http:
  middlewares:
    # Security Headers
    secure-headers:
      headers:
        browserXssFilter: true
        contentTypeNosniff: true
        frameDeny: true
        stsSeconds: 31536000
        stsIncludeSubdomains: true
        stsPreload: true
        forceSTSHeader: true
        customFrameOptionsValue: "SAMEORIGIN"
        referrerPolicy: "strict-origin-when-cross-origin"
        permissionsPolicy: "camera=(), microphone=(), geolocation=(), payment=()"
        customResponseHeaders:
          X-Powered-By: ""
          Server: ""

    # Rate Limiting
    rate-limit:
      rateLimit:
        average: 100
        burst: 50
        period: 1m

    # HTTPS Redirect
    https-redirect:
      redirectScheme:
        scheme: https
        permanent: true

tls:
  options:
    default:
      minVersion: VersionTLS12
      cipherSuites:
        - TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384
        - TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
        - TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
        - TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
        - TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305
        - TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305
```

### 7.3 Set Correct Permissions

```bash
# Ensure acme.json has correct permissions
chmod 600 /opt/n8n/traefik/acme.json

# Create logs directory
mkdir -p /opt/n8n/traefik/logs
```

---

## 8. Firewall Configuration (UFW)

### 8.1 Install and Configure UFW

```bash
sudo apt install -y ufw
```

### 8.2 Set Default Policies

```bash
# Default deny incoming, allow outgoing
sudo ufw default deny incoming
sudo ufw default allow outgoing
```

### 8.3 Allow Required Ports

```bash
# Allow SSH (do this FIRST to avoid lockout!)
sudo ufw allow OpenSSH

# Allow HTTP (for Let's Encrypt validation and redirect)
sudo ufw allow 80/tcp

# Allow HTTPS
sudo ufw allow 443/tcp
```

### 8.4 Enable Rate Limiting for SSH

```bash
sudo ufw limit ssh/tcp comment 'Rate limit SSH'
```

### 8.5 Fix Docker UFW Bypass Issue

Docker modifies iptables directly, bypassing UFW rules. Add the following fix:

```bash
sudo nano /etc/ufw/after.rules
```

Add this block at the **END** of the file (after the existing COMMIT):

```
# BEGIN UFW AND DOCKER
*filter
:ufw-user-forward - [0:0]
:ufw-docker-logging-deny - [0:0]
:DOCKER-USER - [0:0]
-A DOCKER-USER -j ufw-user-forward

-A DOCKER-USER -j RETURN -s 10.0.0.0/8
-A DOCKER-USER -j RETURN -s 172.16.0.0/12
-A DOCKER-USER -j RETURN -s 192.168.0.0/16

-A DOCKER-USER -p udp -m udp --sport 53 --dport 1024:65535 -j RETURN

-A DOCKER-USER -j ufw-docker-logging-deny -p tcp -m tcp --tcp-flags FIN,SYN,RST,ACK SYN -d 192.168.0.0/16
-A DOCKER-USER -j ufw-docker-logging-deny -p tcp -m tcp --tcp-flags FIN,SYN,RST,ACK SYN -d 10.0.0.0/8
-A DOCKER-USER -j ufw-docker-logging-deny -p tcp -m tcp --tcp-flags FIN,SYN,RST,ACK SYN -d 172.16.0.0/12
-A DOCKER-USER -j ufw-docker-logging-deny -p udp -m udp --dport 0:32767 -d 192.168.0.0/16
-A DOCKER-USER -j ufw-docker-logging-deny -p udp -m udp --dport 0:32767 -d 10.0.0.0/8
-A DOCKER-USER -j ufw-docker-logging-deny -p udp -m udp --dport 0:32767 -d 172.16.0.0/12

-A DOCKER-USER -j RETURN

-A ufw-docker-logging-deny -m limit --limit 3/min --limit-burst 10 -j LOG --log-prefix "[UFW DOCKER BLOCK] "
-A ufw-docker-logging-deny -j DROP

COMMIT
# END UFW AND DOCKER
```

### 8.6 Enable UFW

```bash
# Enable UFW
sudo ufw enable

# Check status
sudo ufw status verbose
```

Expected output:

```
Status: active

To                         Action      From
--                         ------      ----
OpenSSH                    LIMIT       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
OpenSSH (v6)               LIMIT       Anywhere (v6)
80/tcp (v6)                ALLOW       Anywhere (v6)
443/tcp (v6)               ALLOW       Anywhere (v6)
```

### 8.7 Reload UFW After Changes

```bash
sudo ufw reload
```

---

## 9. SSH Hardening

### 9.1 Backup Current SSH Configuration

```bash
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup
```

### 9.2 Create Hardened SSH Configuration

```bash
sudo nano /etc/ssh/sshd_config
```

Replace with the following hardened configuration:

```bash
# ===========================================
# Hardened SSH Configuration
# ===========================================

# Basic Settings
Port 22
Protocol 2
AddressFamily inet

# Host Keys
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key

# Authentication
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
PermitEmptyPasswords no
ChallengeResponseAuthentication no

# Limit Users (uncomment and set your username)
AllowUsers deploy

# Security Settings
MaxAuthTries 3
MaxSessions 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
StrictModes yes

# Disable Unused Features
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
PermitTunnel no
PermitUserEnvironment no
PrintMotd no

# Strong Cryptographic Settings
KexAlgorithms sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512

Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr

MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com

# Logging
SyslogFacility AUTH
LogLevel VERBOSE
```

**Important:** Ensure `AllowUsers deploy` matches your actual username.

### 9.3 Test SSH Configuration

**Before** restarting SSH, validate the configuration:

```bash
sudo sshd -t
```

If no errors appear, proceed.

### 9.4 Apply SSH Changes

```bash
sudo systemctl restart sshd
```

### 9.5 Test New SSH Connection

**Keep your current session open** and open a **new terminal** to test:

```bash
ssh deploy@51.178.50.194
```

If you can log in successfully, the configuration is working.

### 9.6 Install and Configure Fail2ban

```bash
sudo apt install -y fail2ban
```

Create a local configuration:

```bash
sudo nano /etc/fail2ban/jail.local
```

Add:

```ini
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
banaction = ufw
banaction_allports = ufw
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 24h
findtime = 1h
```

Enable and start Fail2ban:

```bash
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Verify status
sudo fail2ban-client status sshd
```

---

## 10. Container Deployment and Startup

### 10.1 Navigate to Project Directory

```bash
cd /opt/n8n
```

### 10.2 Create Docker Network

```bash
docker network create n8n-network
```

### 10.3 Pull Latest Images

```bash
docker compose pull
```

### 10.4 Start All Services

```bash
docker compose up -d
```

### 10.5 Monitor Startup Logs

Watch the logs to ensure all services start correctly:

```bash
# Follow all logs
docker compose logs -f

# Or specific service
docker compose logs -f n8n
docker compose logs -f traefik
```

### 10.6 Check Container Status

```bash
docker compose ps
```

Expected output (all should be "healthy" after startup period):

```
NAME          IMAGE                  STATUS                   PORTS
n8n           n8nio/n8n:latest      Up (healthy)             5678/tcp
n8n-postgres  postgres:16-alpine    Up (healthy)             5432/tcp
n8n-redis     redis:7-alpine        Up (healthy)             6379/tcp
n8n-worker    n8nio/n8n:latest      Up                       
traefik       traefik:v3.2          Up (healthy)             0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
```

### 10.7 Wait for SSL Certificate

Let's Encrypt certificates are obtained automatically. Monitor Traefik logs:

```bash
docker compose logs -f traefik | grep -i acme
```

Certificate provisioning typically takes 1-2 minutes.

---

## 11. Verification Steps

### 11.1 Verify DNS Resolution

```bash
dig n8n.tuhhuevoh.com +short
# Expected: 51.178.50.194
```

### 11.2 Verify HTTPS Redirect

```bash
curl -I http://n8n.tuhhuevoh.com
```

Expected response (301 redirect to HTTPS):

```
HTTP/1.1 301 Moved Permanently
Location: https://n8n.tuhhuevoh.com/
```

### 11.3 Verify SSL Certificate

```bash
curl -I https://n8n.tuhhuevoh.com
```

Expected response:

```
HTTP/2 200 
content-type: text/html; charset=utf-8
```

Check SSL certificate details:

```bash
echo | openssl s_client -connect n8n.tuhhuevoh.com:443 -servername n8n.tuhhuevoh.com 2>/dev/null | openssl x509 -noout -dates -issuer
```

### 11.4 Access n8n Web Interface

Open your browser and navigate to:

```
https://n8n.tuhhuevoh.com
```

You should see the n8n setup wizard to create your first user account.

### 11.5 Verify n8n Health Endpoint

```bash
curl https://n8n.tuhhuevoh.com/healthz
```

Expected response:

```json
{"status":"ok"}
```

### 11.6 Verify Queue Mode is Active

Check n8n logs for queue mode confirmation:

```bash
docker compose logs n8n | grep -i queue
```

You should see messages indicating queue mode is active.

### 11.7 Verify Worker is Processing

```bash
docker compose logs n8n-worker | grep -i "ready"
```

### 11.8 Test Webhook Functionality

After creating your first user and logging in:

1. Create a simple workflow with a Webhook trigger
2. Copy the webhook URL
3. Test it with curl:

```bash
curl -X POST https://n8n.tuhhuevoh.com/webhook/your-webhook-path \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

### 11.9 Verify Database Connectivity

```bash
docker exec -it n8n-postgres psql -U n8n -d n8n -c "\dt"
```

You should see n8n tables listed.

### 11.10 Verify Redis Connectivity

```bash
docker exec -it n8n-redis redis-cli ping
# Expected: PONG
```

---

## 12. Backup Procedures

### 12.1 Create PostgreSQL Backup Script

```bash
nano /opt/n8n/scripts/backup-postgres.sh
```

Add:

```bash
#!/bin/bash
set -e

# Configuration
CONTAINER_NAME="n8n-postgres"
BACKUP_DIR="/opt/n8n/backups/postgres"
POSTGRES_USER="${POSTGRES_USER:-n8n}"
POSTGRES_DB="${POSTGRES_DB:-n8n}"
RETENTION_DAYS=7
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="${BACKUP_DIR}/${POSTGRES_DB}_${DATE}.sql.gz"

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Create backup
echo "[$(date)] Starting backup of ${POSTGRES_DB}..."
docker exec -t ${CONTAINER_NAME} pg_dump -U ${POSTGRES_USER} ${POSTGRES_DB} | gzip > "${BACKUP_FILE}"

# Verify backup
if [ -f "${BACKUP_FILE}" ] && [ -s "${BACKUP_FILE}" ]; then
    echo "[$(date)] Backup successful: ${BACKUP_FILE}"
    echo "Size: $(du -h ${BACKUP_FILE} | cut -f1)"
else
    echo "[$(date)] ERROR: Backup failed!"
    exit 1
fi

# Remove old backups
echo "[$(date)] Removing backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete

echo "[$(date)] Backup completed successfully!"
```

### 12.2 Create Complete Backup Script

```bash
nano /opt/n8n/scripts/backup-all.sh
```

Add:

```bash
#!/bin/bash
set -e

SCRIPT_DIR="/opt/n8n/scripts"
LOG_FILE="/var/log/n8n-backup.log"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_BASE="/opt/n8n/backups"

echo "=== n8n Backup Started: $(date) ===" | tee -a ${LOG_FILE}

# Source environment variables
if [ -f /opt/n8n/.env ]; then
    export $(grep -v '^#' /opt/n8n/.env | xargs)
fi

# Backup PostgreSQL
${SCRIPT_DIR}/backup-postgres.sh 2>&1 | tee -a ${LOG_FILE}

# Backup Docker volumes
echo "[$(date)] Backing up Docker volumes..." | tee -a ${LOG_FILE}
VOLUMES_BACKUP="${BACKUP_BASE}/volumes/volumes_${DATE}.tar.gz"
mkdir -p "${BACKUP_BASE}/volumes"

docker run --rm \
    -v n8n_n8n_data:/n8n_data:ro \
    -v n8n_redis_data:/redis_data:ro \
    -v ${BACKUP_BASE}/volumes:/backup \
    alpine tar czf /backup/volumes_${DATE}.tar.gz /n8n_data /redis_data 2>/dev/null || true

# Backup configuration files
echo "[$(date)] Backing up configuration files..." | tee -a ${LOG_FILE}
CONFIG_BACKUP="${BACKUP_BASE}/config_${DATE}.tar.gz"
tar czf ${CONFIG_BACKUP} \
    --exclude='backups' \
    --exclude='traefik/logs' \
    -C /opt/n8n \
    docker-compose.yml .env traefik/

# Cleanup old volume backups (keep 7 days)
find "${BACKUP_BASE}/volumes" -name "*.tar.gz" -type f -mtime +7 -delete
find "${BACKUP_BASE}" -maxdepth 1 -name "config_*.tar.gz" -type f -mtime +7 -delete

echo "=== n8n Backup Completed: $(date) ===" | tee -a ${LOG_FILE}
```

### 12.3 Make Scripts Executable

```bash
chmod +x /opt/n8n/scripts/*.sh
```

### 12.4 Test Backup Scripts

```bash
# Test PostgreSQL backup
/opt/n8n/scripts/backup-postgres.sh

# Test complete backup
/opt/n8n/scripts/backup-all.sh

# Verify backups were created
ls -la /opt/n8n/backups/postgres/
ls -la /opt/n8n/backups/
```

### 12.5 Set Up Automated Backups with Cron

```bash
sudo crontab -e
```

Add the following line (daily backup at 2 AM):

```
0 2 * * * /opt/n8n/scripts/backup-all.sh >> /var/log/n8n-backup.log 2>&1
```

### 12.6 Restore Procedures

To restore PostgreSQL from backup:

```bash
# Stop n8n services first
cd /opt/n8n
docker compose stop n8n n8n-worker

# Restore database
gunzip -c /opt/n8n/backups/postgres/n8n_YYYY-MM-DD_HH-MM-SS.sql.gz | \
    docker exec -i n8n-postgres psql -U n8n -d n8n

# Restart services
docker compose start n8n n8n-worker
```

---

## 13. Maintenance and Monitoring

### 13.1 View Container Logs

```bash
# All services
docker compose logs -f

# Specific service with timestamps
docker compose logs -f --timestamps n8n

# Last 100 lines
docker compose logs --tail=100 n8n
```

### 13.2 Monitor Resource Usage

```bash
# Real-time container stats
docker stats

# Specific containers
docker stats n8n n8n-worker n8n-postgres n8n-redis traefik
```

### 13.3 Check Disk Usage

```bash
# System disk usage
df -h

# Docker disk usage
docker system df

# Volume sizes
docker system df -v | grep -A 20 "VOLUME NAME"
```

### 13.4 Update Containers

To update to the latest n8n version:

```bash
cd /opt/n8n

# Pull latest images
docker compose pull

# Recreate containers with new images
docker compose up -d

# Verify update
docker compose ps
docker compose logs --tail=50 n8n
```

### 13.5 Clean Up Unused Docker Resources

```bash
# Remove unused images, containers, volumes, networks
docker system prune -a

# Remove only dangling images
docker image prune

# Remove unused volumes (careful!)
docker volume prune
```

### 13.6 PostgreSQL Maintenance

Run periodic maintenance:

```bash
# Vacuum and analyze
docker exec -it n8n-postgres psql -U n8n -d n8n -c "VACUUM ANALYZE;"

# Check database size
docker exec -it n8n-postgres psql -U n8n -d n8n -c "\l+"
```

### 13.7 Log Rotation Configuration

Docker logs are already configured with rotation in daemon.json. For additional log management:

```bash
# Check log sizes
sudo du -sh /var/lib/docker/containers/*/

# View Traefik access logs
tail -f /opt/n8n/traefik/logs/access.log | jq .
```

### 13.8 Health Check Commands

Create a simple health check script:

```bash
nano /opt/n8n/scripts/healthcheck.sh
```

Add:

```bash
#!/bin/bash

echo "=== n8n Health Check ==="
echo ""

# Check containers
echo "Container Status:"
docker compose -f /opt/n8n/docker-compose.yml ps --format "table {{.Name}}\t{{.Status}}"
echo ""

# Check n8n health
echo "n8n Health Endpoint:"
curl -s https://n8n.tuhhuevoh.com/healthz
echo ""
echo ""

# Check SSL certificate expiry
echo "SSL Certificate Expiry:"
echo | openssl s_client -connect n8n.tuhhuevoh.com:443 -servername n8n.tuhhuevoh.com 2>/dev/null | openssl x509 -noout -dates
echo ""

# Check disk space
echo "Disk Usage:"
df -h / | tail -1
echo ""

# Check memory
echo "Memory Usage:"
free -h | grep Mem
echo ""

echo "=== Health Check Complete ==="
```

```bash
chmod +x /opt/n8n/scripts/healthcheck.sh
```

---

## 14. Troubleshooting Common Issues

### 14.1 n8n Won't Start

**Check logs:**
```bash
docker compose logs n8n
```

**Common causes:**
- Database not ready: Ensure PostgreSQL is healthy before n8n starts
- Wrong encryption key: Verify `N8N_ENCRYPTION_KEY` matches original
- Port conflict: Check if port 5678 is already in use

**Solution:**
```bash
# Restart services in order
docker compose restart postgres
sleep 10
docker compose restart redis
sleep 5
docker compose restart n8n n8n-worker
```

### 14.2 SSL Certificate Not Working

**Check Traefik logs:**
```bash
docker compose logs traefik | grep -i acme
docker compose logs traefik | grep -i error
```

**Common causes:**
- DNS not propagated: Wait for DNS propagation
- Port 80 blocked: Ensure port 80 is accessible for HTTP challenge
- Cloudflare proxy enabled: Disable proxy (gray cloud) for initial setup
- acme.json permissions: Must be 600

**Solutions:**
```bash
# Check acme.json permissions
ls -la /opt/n8n/traefik/acme.json
chmod 600 /opt/n8n/traefik/acme.json

# Check if port 80 is reachable
curl -I http://n8n.tuhhuevoh.com

# Reset certificates (last resort)
rm /opt/n8n/traefik/acme.json
touch /opt/n8n/traefik/acme.json
chmod 600 /opt/n8n/traefik/acme.json
docker compose restart traefik
```

### 14.3 Database Connection Errors

**Check PostgreSQL:**
```bash
docker compose logs postgres
docker exec -it n8n-postgres pg_isready -U n8n -d n8n
```

**Verify credentials:**
```bash
docker exec -it n8n-postgres psql -U n8n -d n8n -c "SELECT 1;"
```

### 14.4 Redis Connection Issues

**Check Redis:**
```bash
docker compose logs redis
docker exec -it n8n-redis redis-cli ping
```

**Check memory:**
```bash
docker exec -it n8n-redis redis-cli info memory
```

### 14.5 Worker Not Processing Jobs

**Check worker logs:**
```bash
docker compose logs n8n-worker
```

**Verify queue mode:**
```bash
docker exec -it n8n-redis redis-cli keys "*bull*"
```

**Common causes:**
- Different encryption keys between n8n and worker
- Redis not accessible from worker
- Worker not in same network

### 14.6 High Memory Usage

**Check container memory:**
```bash
docker stats --no-stream
```

**Solutions:**
- Reduce `shared_buffers` in PostgreSQL
- Lower `maxmemory` in Redis
- Enable execution data pruning in n8n
- Add more RAM or use swap

### 14.7 Webhooks Not Working

**Check webhook URL configuration:**
```bash
docker compose exec n8n printenv | grep WEBHOOK
```

**Verify:**
- `WEBHOOK_URL` is set to `https://n8n.tuhhuevoh.com/`
- SSL is working
- Firewall allows port 443

**Test webhook manually:**
```bash
curl -X POST https://n8n.tuhhuevoh.com/webhook/test \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### 14.8 Container Keeps Restarting

**Check restart count:**
```bash
docker compose ps
```

**Check logs for errors:**
```bash
docker compose logs --tail=100 [container_name]
```

**Common causes:**
- Health check failing
- Out of memory (OOM kill)
- Configuration errors

**Check for OOM:**
```bash
dmesg | grep -i oom
journalctl -k | grep -i "out of memory"
```

### 14.9 Slow Performance

**Check resource usage:**
```bash
docker stats
htop
```

**Solutions:**
- Increase PostgreSQL `shared_buffers`
- Enable execution data pruning
- Add more workers for queue mode
- Check for slow workflows and optimize

### 14.10 Useful Debug Commands

```bash
# Inspect container
docker inspect n8n

# Execute command in container
docker exec -it n8n /bin/sh

# Check network connectivity
docker exec -it n8n ping postgres
docker exec -it n8n ping redis

# View environment variables
docker compose exec n8n printenv

# Check file permissions in container
docker exec -it n8n ls -la /home/node/.n8n/

# Force recreate containers
docker compose up -d --force-recreate

# View Docker events
docker events --filter container=n8n
```

---

## Memory Allocation Summary

For optimal performance on a **12GB RAM VPS**, the services are configured as follows:

| Service | Memory Limit | Purpose |
|---------|--------------|---------|
| PostgreSQL | 4GB | Primary database with shared_buffers=1GB |
| Redis | 1GB | Queue broker with maxmemory=512MB |
| n8n (main) | 2GB | Editor UI and webhook handling |
| n8n-worker | 2GB | Workflow execution |
| Traefik | 256MB | Reverse proxy and SSL |
| **OS/System** | ~2.75GB | Operating system and file caching |

---

## Quick Reference Commands

```bash
# Navigate to project
cd /opt/n8n

# Start all services
docker compose up -d

# Stop all services
docker compose down

# Restart a specific service
docker compose restart n8n

# View logs
docker compose logs -f

# Check status
docker compose ps

# Update to latest version
docker compose pull && docker compose up -d

# Run backup
/opt/n8n/scripts/backup-all.sh

# Health check
/opt/n8n/scripts/healthcheck.sh

# Check SSL certificate expiry
echo | openssl s_client -connect n8n.tuhhuevoh.com:443 2>/dev/null | openssl x509 -noout -dates
```

---

## Security Checklist

Before going to production, verify:

- [ ] Root SSH login disabled
- [ ] Password authentication disabled
- [ ] SSH keys configured
- [ ] UFW firewall enabled with only ports 22, 80, 443 open
- [ ] Fail2ban installed and configured
- [ ] Strong PostgreSQL password set
- [ ] n8n encryption key backed up securely
- [ ] `.env` file has proper permissions (600)
- [ ] SSL certificate active and valid
- [ ] Automated backups configured
- [ ] Docker log rotation enabled

---

This documentation provides a complete, production-ready deployment of n8n with queue mode on your VPS running **Ubuntu 25.10**. The setup includes enterprise-grade security configurations, performance optimizations for your 12GB RAM environment, automated SSL management, and comprehensive backup procedures. After completing all steps, your n8n instance will be accessible at `https://n8n.tuhhuevoh.com` with full queue mode capabilities for scalable workflow execution.