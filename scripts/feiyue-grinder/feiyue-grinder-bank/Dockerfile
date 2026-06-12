FROM docker.m.daocloud.io/library/python:3.11-slim
WORKDIR /app
COPY bank_server.py /app/
ENV BANK_DB=/data/bank.db BANK_PORT=8799
EXPOSE 8799
CMD ["python","-u","bank_server.py"]
