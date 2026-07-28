#!/bin/sh
# Without a resolver, nginx resolves upstreams once at startup and exits with
# "host not found in upstream" whenever the backend container is not up yet.
# The resolver address differs per runtime (Docker uses 127.0.0.11, podman uses
# the network gateway), so derive it from the container's own resolv.conf.
set -e

resolver=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)
[ -n "$resolver" ] || resolver="127.0.0.11"

# Bracket IPv6 literals so nginx parses them.
case "$resolver" in
  *:*) resolver="[$resolver]" ;;
esac

printf 'resolver %s valid=10s ipv6=off;\n' "$resolver" > /tmp/popinn-resolver.conf
