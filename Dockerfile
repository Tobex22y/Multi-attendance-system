# Use PHP 8.2 with Apache built in
FROM php:8.2-apache

# Install system packages needed for PDO MySQL, GD (images/QR), and zip (TCPDF)
RUN apt-get update && apt-get install -y \
    libzip-dev \
    libpng-dev \
    libjpeg-dev \
    libfreetype6-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install pdo pdo_mysql mysqli gd zip \
    && a2enmod rewrite

# Set the working directory to Apache's web root
WORKDIR /var/www/html

# Copy your entire project (frontend/, backend/, database/, etc.) into the container
COPY . /var/www/html/

# Make sure Apache can read/write where needed (e.g. uploaded profile images, generated receipts)
RUN chown -R www-data:www-data /var/www/html

# Copy in the startup script that configures Apache's port at container run time
# (Render assigns $PORT dynamically — it's not known until the container starts)
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

CMD ["/docker-entrypoint.sh"]
