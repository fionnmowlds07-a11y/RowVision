# Built from the repository root: docker build -f services/worker/Dockerfile .
FROM python:3.12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/vision ./vision
COPY services/worker ./worker
RUN pip install --no-cache-dir -e ./vision ./worker
# The models download here, into a volume that takes its owner from this folder.
RUN useradd --create-home worker && mkdir /home/worker/.cache && chown worker /home/worker/.cache
USER worker
CMD ["python", "-m", "rowvision_worker.main"]
