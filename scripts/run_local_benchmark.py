"""Воспроизводимый бесплатный прогон трёх GGUF через собственный llama-server.

Манифест содержит неизменяемые ревизии и SHA-256. Веса и runtime скачиваются отдельно.
Запускается только локальный HTTP, без платных API и без передачи данных наружу.
"""

import argparse
import hashlib
import json
import platform
import socket
import subprocess
import time
from pathlib import Path

import httpx

from adoption_compass.evals.benchmark import BenchmarkRun, RecordingProvider, make_artifact
from adoption_compass.evals.providers import OpenAICompatibleProvider
from adoption_compass.evals.runner import run_eval
from adoption_compass.evals.task import load_items, load_task


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--models-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8091)
    parser.add_argument("--threads", type=int, default=6)
    args = parser.parse_args()
    runtime = args.runtime.resolve(strict=True)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    task = load_task()
    items = load_items(task)
    runs, reports = [], []
    args.out.parent.mkdir(parents=True, exist_ok=True)
    for spec in [entry for entry in manifest if "repo" in entry]:
        # Не подключаться к чужому серверу на том же порту под именем другой модели.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", args.port))
        weights = (args.models_dir / spec["file"]).resolve(strict=True)
        with weights.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != spec["sha256"]:
                raise ValueError(f"Checksum mismatch: {weights.name}")
        model = spec["repo"].split("/")[1].removesuffix("-GGUF")
        command = [
            str(runtime),
            "-m",
            str(weights),
            "--host",
            "127.0.0.1",
            "--port",
            str(args.port),
            "--ctx-size",
            "2048",
            "--parallel",
            "1",
            "--threads",
            str(args.threads),
            "--no-webui",
            "--no-cache-prompt",
        ]
        extra = {"chat_template_kwargs": {"enable_thinking": False}}
        with (args.models_dir / "benchmark-server.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                command,
                stdout=log,
                stderr=log,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            provider = OpenAICompatibleProvider(
                f"http://127.0.0.1:{args.port}/v1",
                model,
                name=f"local:{model}",
                timeout=120,
                max_retries=0,
                extra_body=extra,
            )
            try:
                with httpx.Client(timeout=2) as client:
                    for _ in range(120):
                        if process.poll() is not None:
                            raise RuntimeError("llama-server завершился: см. benchmark-server.log")
                        try:
                            if (
                                client.get(f"http://127.0.0.1:{args.port}/health").status_code
                                == 200
                            ):
                                break
                        except httpx.HTTPError:
                            pass
                        time.sleep(0.5)
                    else:
                        raise TimeoutError("llama-server не готов за 60 секунд")
                recorder = RecordingProvider(provider, task, items)
                print(f"Running {model}: {len(items)} items", flush=True)
                report = run_eval(recorder, task, items)
                if report.errors:
                    raise RuntimeError(
                        f"{model}: {report.errors} transport errors; partial results not published"
                    )
                reports.append(report)
                runs.append(
                    BenchmarkRun(
                        provider=provider.name,
                        model_source=f"https://huggingface.co/{spec['repo']}",
                        revision=spec["revision"],
                        weights_sha256=spec["sha256"],
                        quantization="Q8_0",
                        parameters={"temperature": 0, "max_tokens": 64, **extra},
                        observations=recorder.observations,
                    )
                )
                print(
                    f"Completed {model}: accuracy={report.metrics.accuracy:.3f}, F1={report.metrics.macro_f1:.3f}, invalid={report.metrics.invalid}",
                    flush=True,
                )
            finally:
                provider.close()
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    artifact = make_artifact(
        runs,
        reports,
        {
            "engine": "llama.cpp b11854",
            "runtime_sha256": hashlib.sha256(runtime.read_bytes()).hexdigest(),
            "platform": platform.platform(),
            "cpu": platform.processor(),
            "threads": args.threads,
            "context": 2048,
            "parallel": 1,
            "prompt_cache": False,
            "seed": "greedy (temperature=0)",
            "protocol": "OpenAI-compatible Chat Completions on loopback",
        },
    )
    temporary = args.out.with_suffix(".tmp")
    temporary.write_text(artifact.model_dump_json(indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.out)
    print(f"Saved {args.out}", flush=True)


if __name__ == "__main__":
    main()
