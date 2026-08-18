# Security

This is an offline HTML app that runs from a school's shared drive. It has no
server, no network calls and no accounts, so most of the usual attack surface
is not here. What is worth reporting:

- **Anything that could make the app write to the school's source files.**
  It opens that folder read-only and must stay that way.
- **A way to get script into a namelist through student or teacher data** — a
  name, a subject cell, a teacher's suggestion. Every value is escaped on the
  way into the page; a gap in that is worth reporting.
- **A way to lose data through the save or merge path**, especially with two
  admins editing at once.

Please **do not open a public issue** for these. Use GitHub's private reporting
— *Security* → *Report a vulnerability* on this repository — so it can be fixed
before it is described in public.

Anything else (a crash, a wrong namelist, a bad import) is an ordinary bug and
belongs in a normal issue.
