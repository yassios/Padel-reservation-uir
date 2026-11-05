#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Keep this tag in sync with k8s/kustomization.yaml when publishing an update.
image_tag=${IMAGE_TAG:-local-v1}
cluster_name=${KIND_CLUSTER:-learning}
docker build -t "uir-padel-backend:$image_tag" backend
docker build -t "uir-padel-frontend:$image_tag" frontend
kind load docker-image --name "$cluster_name" "uir-padel-backend:$image_tag" "uir-padel-frontend:$image_tag"
