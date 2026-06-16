# Blog Abstract: doc-haus on OpenShift

## Thesis
Deploying doc.haus, a self-hosted multi-agent legal AI platform, on OpenShift proves that complex agentic AI applications with document processing, retrieval-augmented Q&A, and multi-agent orchestration can run on enterprise Kubernetes with minimal modifications.

## Target Audience
Platform engineers, ML engineers, and legal technology teams evaluating self-hosted AI solutions for data-sovereign document processing.

## Blog Type
Red Hat Developer Blog

## Key Points
1. doc.haus runs three co-located processes (engine, ingest, web) in a single container, containerized on UBI9 Node.js with Bun runtime
2. The platform uses CPU-based embeddings and configurable LLM providers, needing no GPU resources for deployment
3. All three services passed health checks on OpenShift, validating the architecture for enterprise deployment

## Products/Projects
Red Hat OpenShift AI, Open Data Hub, UBI9, Quay.io

## CTA
Try deploying your own legal AI or document processing application on OpenShift using this approach.

## Proposed Sections
1. What is doc.haus?
2. Why it matters for enterprise legal AI
3. Containerizing for OpenShift
4. Deploying to the cluster
5. What the tests showed
6. What we learned
7. Try it yourself
