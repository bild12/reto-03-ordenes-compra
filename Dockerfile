# Imagen de producción: Bun + dependencias de runtime. La clave se inyecta como variable de entorno.
FROM oven/bun:1-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY agent ./agent
COPY src ./src
COPY web ./web
COPY fixtures ./fixtures
RUN mkdir -p out && chown -R bun:bun /app
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER bun
CMD ["bun", "src/server.ts"]
