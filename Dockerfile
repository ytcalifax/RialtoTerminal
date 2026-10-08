FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RIALTO_BIND_HOST=0.0.0.0 \
    RIALTO_PORT=8765 \
    OPENSKY_CREDENTIALS="" \
    WORLDMONITOR_API_KEY=""

WORKDIR /app

RUN pip install --no-cache-dir "h3>=4.2"

COPY --chown=10001:10001 index.html ./index.html
COPY --chown=10001:10001 assets/ ./assets/
COPY --chown=10001:10001 server/ ./server/

USER 10001:10001

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "from urllib.request import urlopen; response = urlopen('http://127.0.0.1:8765/', timeout=3); response.close()"]

ENTRYPOINT ["python", "-m", "server"]
CMD []
