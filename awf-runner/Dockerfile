# syntax=docker/dockerfile:1
#
# Headless AWF node runner image (awf-node).
#
# awf-runner depends on the sibling workspace package dsh-plugin-workflow
# (not published to npm), so the build context must be the REPOSITORY ROOT:
#
#   docker build -f awf-runner/Dockerfile -t awf-node .
#
# Run (state persisted in a volume; tokens only via env):
#
#   docker run -d --name awf-node \
#     -e AWF_API_TOKEN=<platform-user-token> \
#     -e AWF_NODE_LLM_BASE_URL=https://api.openai.com/v1 \
#     -e AWF_NODE_LLM_API_KEY=<llm-key> \
#     -e AWF_NODE_LLM_MODEL=<model> \
#     -v awf-node-state:/home/awf/.awf-node \
#     awf-node serve --platform https://awf.example.com --concurrency 2
#
# `awf-node login`/`register` can substitute for AWF_API_TOKEN (session stored
# under the state dir volume): docker run --rm -it -v awf-node-state:... \
#   awf-node login --platform ... --email ... (password via AWF_NODE_PASSWORD).

FROM node:24-slim AS build
WORKDIR /src
COPY dsh-plugin-workflow ./dsh-plugin-workflow
COPY awf-runner ./awf-runner
# dsh-plugin-workflow is a workspace package, not on npm: point the runner's
# dependency at the local sibling copy for this standalone install.
RUN cd /src/awf-runner \
 && npm pkg set 'dependencies.dsh-plugin-workflow=file:../dsh-plugin-workflow' \
 && npm --prefix /src/dsh-plugin-workflow install \
 && npm --prefix /src/dsh-plugin-workflow run build \
 && npm install \
 && npm run build

FROM node:24-slim
ENV NODE_ENV=production
RUN useradd --system --create-home awf
WORKDIR /app
COPY --from=build /src/dsh-plugin-workflow/package.json ./dsh-plugin-workflow/package.json
COPY --from=build /src/dsh-plugin-workflow/lib ./dsh-plugin-workflow/lib
COPY --from=build /src/awf-runner/package.json ./awf-runner/package.json
COPY --from=build /src/awf-runner/lib ./awf-runner/lib
# Production-only install. The workflow engine's cordis peer is type-level
# (no runtime import), so peers are omitted.
RUN cd /app/awf-runner \
 && npm pkg set 'dependencies.dsh-plugin-workflow=file:../dsh-plugin-workflow' \
 && npm install --omit=dev --omit=peer \
 && npm cache clean --force \
 && chown -R awf:awf /app
USER awf
ENTRYPOINT ["node", "/app/awf-runner/lib/bin.js"]
CMD ["serve"]
