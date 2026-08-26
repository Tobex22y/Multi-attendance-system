#!/bin/bash
set -e

# Render assigns a port dynamically via $PORT at runtime.
# Default to 80 if it's not set (e.g. when testing locally).
PORT="${PORT:-80}"

# Rewrite Apache's listen port and virtual host to match Render's assigned port
sed -i "s/Listen 80/Listen ${PORT}/" /etc/apache2/ports.conf
sed -i "s/:80/:${PORT}/" /etc/apache2/sites-available/000-default.conf

exec apache2-foreground
