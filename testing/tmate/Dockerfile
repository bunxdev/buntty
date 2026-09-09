FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171
RUN apt-get update \
    && apt-get install -y --no-install-recommends tmate=2.4.0-2 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 tester
USER tester
WORKDIR /home/tester
ENV TERM=xterm-256color
CMD ["sh", "-c", "tmate -S /tmp/tmate.sock new-session -d -s comparison && exec sleep infinity"]
