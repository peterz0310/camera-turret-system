FROM python:3.11-slim

WORKDIR /app
COPY app.py fallback.jpg .env /app/

RUN pip install flask requests urllib3 python-dotenv

EXPOSE 8081
CMD ["python", "app.py"]
