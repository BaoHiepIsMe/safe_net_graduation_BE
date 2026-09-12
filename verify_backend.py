import subprocess
import sys
import time

COMMANDS = [
    "npx prisma migrate status",
    "npm run prisma:validate",
    "npm run prisma:generate",
    "npm run lint:check",
    "npm run typecheck",
    "npm test",
    "npm run test:e2e",
    "npm run test:integration:supabase",
    "npm run build",
]


def run_command(command: str) -> bool:
    print("\n" + "=" * 80)
    print(f"RUNNING: {command}")
    print("=" * 80)

    start = time.time()

    result = subprocess.run(
        command,
        shell=True,
    )

    duration = time.time() - start

    if result.returncode == 0:
        print(f"\nPASS: {command} ({duration:.1f}s)")
        return True

    print(f"\nFAIL: {command} (exit code: {result.returncode}, {duration:.1f}s)")
    return False


def main():
    print("Starting SafeNet backend verification...\n")

    passed = []
    failed = None

    for command in COMMANDS:
        if run_command(command):
            passed.append(command)
        else:
            failed = command
            break

    print("\n" + "=" * 80)
    print("VERIFICATION SUMMARY")
    print("=" * 80)

    for command in COMMANDS:
        if command in passed:
            print(f"[PASS] {command}")
        elif command == failed:
            print(f"[FAIL] {command}")
        else:
            print(f"[SKIP] {command}")

    print("=" * 80)

    if failed:
        print(f"\nFinal decision: FAIL")
        print(f"Stopped at: {failed}")
        sys.exit(1)

    print("\nFinal decision: PASS")
    sys.exit(0)


if __name__ == "__main__":
    main()
