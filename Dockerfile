FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.lock.txt backend/requirements.lock.txt
RUN pip install --no-cache-dir -r backend/requirements.lock.txt
COPY backend/app backend/app
COPY data/stories.json data/stories.json
COPY data/segmentation_dictionary.json data/segmentation_dictionary.json
COPY data/lexicons/ data/lexicons/
COPY scripts/serve.py scripts/serve.py
ENV PYTHONUNBUFFERED=1 PORT=8000
EXPOSE 8000
CMD ["python", "scripts/serve.py"]
