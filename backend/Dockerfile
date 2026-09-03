FROM python:3.13-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
# Mirrors the repo's own tools/../plugin/src layout so config-editor.html's relative
# <script src="../plugin/src/transform.js"> resolves unmodified when served from here too.
COPY tools/config-editor.html ./static/tools/config-editor.html
COPY plugin/src/transform.js ./static/plugin/src/transform.js

EXPOSE 8080

CMD ["hypercorn", "--bind", "0.0.0.0:8080", "--workers", "1", "app:app"]
