# ไม่มี dependency เลย — python3 เปล่าๆ พอ
FROM python:3.12-slim
WORKDIR /app
COPY server.py storage.py imagegen.py mockimage.py themes.json ./
COPY public ./public
ENV PORT=8080 DATA_DIR=/data IMAGE_PROVIDER=mock
VOLUME ["/data"]
EXPOSE 8080
CMD ["python3", "server.py"]
