# Utilizar una imagen base de Node.js
FROM node:16.3.0-alpine

# Definir el directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package.json package-lock.json ./

# Instalar las dependencias del proyecto
RUN npm i -f

# Copiar el resto del código fuente
COPY . .

# Ejecutar la aplicación
CMD ["node", "./index.js"]
