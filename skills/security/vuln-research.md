<!--
skills/security/vuln-research.md — Vulnerability Research — Use this skill when analyzing binaries, fuzzing software, or developing exploits

Use this skill when analyzing binaries, fuzzing software, or developing exploits for security research. ## Binary Analysis
-->
# Vulnerability Research

Use this skill when analyzing binaries, fuzzing software, or developing exploits for security research.

## Binary Analysis

### Static Analysis
- Identify compiler, language, and build flags (stripped, PIE, stack canaries, RELRO)
- Map function boundaries and call graph
- Locate string references to identify functionality
- Check security mitigations: NX, ASLR, stack protector, FORTIFY_SOURCE
- Identify statically linked libraries and their versions

### Dynamic Analysis
- Trace system calls and library calls (strace, ltrace, dtrace)
- Monitor file, network, and registry activity
- Set breakpoints on interesting functions (malloc, free, recv, send, open)
- Inspect memory layout at runtime: stack, heap, mapped regions
- Use hardware breakpoints for anti-debug evasion

## Fuzzing

### Strategy
- Coverage-guided fuzzing (AFL++, libFuzzer, Honggfuzz) for maximum code coverage
- Grammar-based fuzzing for structured inputs (protocol buffers, file formats)
- Mutation-based fuzzing for unknown formats
- Seed corpus: collect real-world samples, minimize, then fuzz

### Harness Design
- Isolate the target function from the full program
- Initialize state once, fuzz in a loop (persistent mode)
- Sanitizers: AddressSanitizer, UndefinedBehaviorSanitizer, MemorySanitizer
- Monitor for: crashes, hangs, memory leaks, assertion failures

### Triage
- Deduplicate crashes by stack hash
- Minimize crash inputs to smallest reproducer
- Classify: null deref, buffer overflow, use-after-free, integer overflow, type confusion
- Determine exploitability: write-what-where, control of instruction pointer, heap corruption state

## Memory Corruption

### Stack Overflow
- Overwrite return address, saved registers, or local variables
- Bypass canaries: info leak, format string, brute force (forking servers)
- ROP chains: find gadgets with ropper/ROPgadget, chain to control execution

### Heap Exploitation
- Use-after-free: control freed object's memory via replacement allocation
- Heap overflow: corrupt adjacent chunk metadata or application data
- Double free: manipulate allocator free list
- Technique selection depends on allocator: ptmalloc (glibc), jemalloc, tcmalloc, Windows heap

### Format String
- Read: `%x` to leak stack values, `%s` to read pointers
- Write: `%n` to write to arbitrary addresses
- Use direct parameter access (`%7$x`) for precise targeting

### Integer Vulnerabilities
- Overflow/underflow leading to undersized allocations
- Sign confusion between signed and unsigned comparisons
- Truncation when casting between different-width types

## Exploit Development

- Determine target: return address, function pointer, vtable, GOT entry
- Build primitives: arbitrary read, arbitrary write, code execution
- Defeat mitigations:
  - ASLR: information leak to disclose base addresses
  - NX/DEP: ROP, JIT spraying, code reuse
  - Stack canary: leak via info disclosure or brute force
  - CFI: find valid call targets that enable further exploitation
- Test reliability across runs and environments
- Document the full exploit chain

## Responsible Disclosure

- Follow coordinated disclosure timelines (typically 90 days)
- Report to vendor security contact or bug bounty program
- Provide clear reproduction steps and impact assessment
- Do not publish exploit code before patch is available
- Request CVE assignment through CNA or MITRE
