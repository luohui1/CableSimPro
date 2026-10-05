"""Train one complete scene family on Slurm and register its immutable model."""
from argparse import ArgumentParser
from dataclasses import asdict
import importlib.util
from pathlib import Path
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from backend.kernel.batch_files import atomic, digest, read
from backend.kernel.hpc_executor import HpcExecutor


def load_helper(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("directories", nargs="+", type=Path)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for directory in args.directories:
        plan = read(directory / "plan.json")
        missing = [sample["case_id"] for sample in plan["samples"]
                   if not (directory / "samples" / (sample["case_id"] + ".json")).is_file()]
        if missing:
            raise ValueError(f"DATASET_INCOMPLETE: {directory}: {len(missing)} rows missing")
    training = load_helper("training_input").assemble(args.directories)
    args.output.mkdir(parents=True, exist_ok=True)
    parameters = {"seed": 42, "model_version": args.model_version}
    identity = {"dataset_sha256": training["dataset_sha256"], "parameters": parameters}
    operation_file = args.output / "operation.json"
    if operation_file.exists():
        operation = read(operation_file)
        if operation["identity_sha256"] != digest(identity):
            raise ValueError("TRAINING_OPERATION_CHANGED: select a separate output directory")
    else:
        operation = {"operation": str(uuid4()), "identity_sha256": digest(identity), **identity}
        atomic(operation_file, operation)
    atomic(args.output / "input.json", training)
    print({"family": training["family"], "samples": len(training["samples"]), **operation}, flush=True)
    executor = HpcExecutor(profile=args.profile, root=ROOT / ".data/hpc/hybrid-training-runs").for_operation(operation["operation"])
    result = executor.run("cablesim.hybrid-rating", "train-model", [
        {"case_id": "training", "input": training, "parameters": parameters}])
    atomic(args.output / "result.json", asdict(result))
    installed = load_helper("register_model").register(result)
    atomic(args.output / "registered.json", installed)
    print({"model_sha256": installed["model_sha256"],
           "training_job_id": installed["record"]["training_job_id"]}, flush=True)


if __name__ == "__main__":
    main()
