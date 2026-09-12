# Windows native CAD compatibility — verified combination, not an upstream patch

The earlier Windows worker exited with 3221226356 / 3221225477 even when it had
written a STEP file. A nonzero process exit remains an execution failure. There is
no forced `os._exit(0)`, ignored return code, disabled finalizer, or success inferred
from the presence of an output file.

Dependency bisection at `a2f4e36a7b6330282821866447bb63d2334fd15d`, run 34666409362,
compared fresh processes with the same CAD2.8.0 / OCP7.9.3.1.1 / VTK9.6.2 /
NLopt2.11.0 / NumPy2.3.5 environment. With CasADi3.8.0, individual imports and
OCP+CasADi / VTK+CasADi exited normally, while NLopt+CasADi failed on both inherited
and restricted PATH. CadQuery export also ended abnormally. With CasADi3.7.2, all
sixteen corresponding import/export probes exited normally. This isolates an
incompatible tested combination; it does not establish the exact upstream C++ defect.

The selected compatibility set is pinned in `plugins/requirements-native.txt`:
CadQuery2.8.0, cadquery-ocp7.9.3.1.1, VTK9.6.2, CasADi3.7.2 and NLopt2.11.0. These
five exact requirements are also checked by the CAD manifest in the 0.1.2 adapter
release. Multi-component numeric **runtime distribution versions** are separate
from the plugin's stable x.y.z release version. No version ranges or silent fallback
are accepted. Existing project locks are not rewritten during installation.

Regression at `a59fa8fcd8d658d0b0cd4c4cafdedf428572a429`, run 34666705896, passed on
Ubuntu and Windows with Python3.11 and3.12. Each matrix job ran five fresh-process
CAD build/volume/STEP-roundtrip/**natural-exit** checks plus the two original native
integration cases. The updated integration gate repeats these exit checks alongside
the buried reference on its final source revision. Keep environment and JUnit
artifacts with their source-commit records; a diagnostic workflow being green alone
is never a CAD acceptance claim.

These pins are not a full lockfile, wheel hash lock, SBOM, publisher signature or
security sandbox. All other dependencies and actual platform versions remain in
runtime evidence. A future dependency upgrade must repeat the tests before changing
the manifest requirements.

Primary upstream context, not proof of this project's root cause:
- CadQuery issue1911 and maintainer discussion: https://github.com/CadQuery/cadquery/issues/1911
- CadQuery package metadata: https://pypi.org/project/cadquery/2.8.0/
- scikit-fem weak-form/assembly documentation: https://scikit-fem.readthedocs.io/en/latest/howto.html
