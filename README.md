# UIR Padel

A padel court booking app for Université Internationale de Rabat. Students can reserve one hour per week on either of two courts. Administrators manage reservations, student accounts, and maintenance closures.

Built with React, Express/TypeScript, and PostgreSQL. Nginx serves the frontend and forwards API requests to the backend. The database and demo accounts are initialized automatically.

Run the commands below from the project root. Choose one method at a time: both use **http://localhost:8080**.

## 1. Docker Compose

Requires Docker with Compose installed. Compose handles the network, database, and startup order for you.

```sh
cp .env.example .env
docker compose up --build -d
```

Open **http://localhost:8080** once the services finish starting.

To stop the app while keeping database data:

```sh
docker compose down
```

## 2. Kubernetes (kind)

Requires Docker, kind, and kubectl. The provided storage configuration expects a cluster named `learning` with a node named `learning-worker`.

If you do not already have that cluster, create it:

```sh
kind create cluster --name learning --config - <<'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
EOF
```

On first setup, copy the secrets template:

```sh
cp k8s/.env.example k8s/.env
```

Edit `k8s/.env`: replace the password with a URL-safe value and the session secret with a random string of at least 32 characters. Keep this file for future runs.

Build the images, load them into kind, and deploy:

```sh
kubectl config use-context kind-learning
sh scripts/kind-images.sh
kubectl apply -k k8s
```

Allow the pods a moment to start, then open access to the app:

```sh
kubectl -n mini-projet port-forward service/frontend 8080:80
```

Leave the terminal running and open **http://localhost:8080**. Press Ctrl+C to stop port-forwarding.

To stop the app while keeping its data:

```sh
kubectl -n mini-projet scale deployment frontend backend db --replicas=0
```

Run `kubectl apply -k k8s` to resume, then run port-forward again. Database data survives pod restarts, but deleting the kind cluster deletes its data.

## Demo login

Use these accounts with any of the methods above:

| Role    | Email             | Password      |
| ------- | ----------------- | ------------- |
| Admin   | `admin@uir.ac.ma` | `Admin123!`   |
| Student | `amine@uir.ac.ma` | `Student123!` |

These credentials are for local demonstrations.
