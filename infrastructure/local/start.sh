#!/bin/sh
set -eu
rm -f /access/token
(
  until kubectl apply -f /bootstrap/access.yaml; do sleep 4; done
  until kubectl apply -k /bootstrap/preview && kubectl apply -f /bootstrap/preview-port.yaml; do sleep 4; done
  cp /var/lib/rancher/k3s/server/tls/server-ca.crt /access/ca.crt
  while true; do
    if kubectl -n clouddeploy-system create token clouddeploy-api --duration=1h > /access/token.next; then
      chown 1000:1000 /access/token.next
      chmod 0400 /access/token.next
      mv /access/token.next /access/token
      sleep 1200
    else
      sleep 5
    fi
  done
) &
exec k3s server --tls-san k3s --disable traefik --disable servicelb
