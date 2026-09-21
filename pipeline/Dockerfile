# Dev and CI image for the pipeline. The repo is bind-mounted over /work at
# run time, so the editable install below keeps pointing at live source.
FROM python:3.12-slim
WORKDIR /work/pipeline
COPY pipeline/pyproject.toml ./
COPY pipeline/src ./src
RUN pip install --no-cache-dir -e ".[dev]"
