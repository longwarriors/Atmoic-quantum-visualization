from __future__ import annotations

from math import pi

import numpy as np
import pytest

from quviz.conventions import BasisKind
from quviz.physics.hydrogenic import (
    complex_spherical_harmonic,
    hydrogenic_energy_hartree,
    hydrogenic_wavefunction,
    radial_node_radii,
    radial_wavefunction,
    real_spherical_harmonic,
    validate_quantum_numbers,
)
from quviz.physics.observables import (
    hydrogenic_density_floor,
    probability_current_hydrogenic,
    probability_density,
)


@pytest.mark.parametrize(
    ("n", "l", "m"),
    [(1, 0, 0), (2, 1, -1), (3, 2, 2), (5, 4, 0)],
)
def test_quantum_numbers_accept_valid_domain(n: int, l: int, m: int) -> None:
    validate_quantum_numbers(n, l, m)


@pytest.mark.parametrize(
    ("n", "l", "m"),
    [(0, 0, 0), (2, 2, 0), (2, 1, 2), (2, -1, 0)],
)
def test_quantum_numbers_reject_invalid_domain(n: int, l: int, m: int) -> None:
    with pytest.raises(ValueError):
        validate_quantum_numbers(n, l, m)


@pytest.mark.parametrize(
    ("n", "l", "m"),
    [
        (1.0, 0, 0),
        (1.5, 0, 0),
        (True, 0, 0),
        (2, 1.0, 0),
        (2, True, 0),
        (2, 1, 1.0),
        (2, 1, False),
    ],
)
def test_quantum_numbers_reject_non_integer_and_boolean_values(
    n: object, l: object, m: object
) -> None:
    with pytest.raises(ValueError, match="integer"):
        validate_quantum_numbers(n, l, m)  # type: ignore[arg-type]


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_energy_and_radial_wavefunction_reject_non_finite_scales(bad: float) -> None:
    with pytest.raises(ValueError, match="z must be positive and finite"):
        hydrogenic_energy_hartree(1, z=bad)
    with pytest.raises(ValueError, match="reduced_mass_ratio must be positive and finite"):
        hydrogenic_energy_hartree(1, reduced_mass_ratio=bad)
    with pytest.raises(ValueError, match="z must be positive and finite"):
        radial_wavefunction(1, 0, np.asarray([0.0, 1.0]), z=bad)
    with pytest.raises(ValueError, match="a_mu must be positive and finite"):
        radial_wavefunction(1, 0, np.asarray([0.0, 1.0]), a_mu=bad)


@pytest.mark.parametrize("radius", [[float("nan")], [float("inf")], [float("-inf")]])
def test_radial_wavefunction_rejects_non_finite_coordinates(radius: list[float]) -> None:
    with pytest.raises(ValueError, match="r must contain only finite values"):
        radial_wavefunction(1, 0, radius)


@pytest.mark.parametrize(
    ("l", "m"),
    [(True, 0), (1.0, 0), (1, False), (1, 1.0)],
)
@pytest.mark.parametrize("harmonic", [complex_spherical_harmonic, real_spherical_harmonic])
def test_spherical_harmonics_reject_boolean_and_non_integer_quantum_numbers(
    harmonic: object, l: object, m: object
) -> None:
    with pytest.raises(ValueError, match="integer"):
        harmonic(l, m, [0.0], [0.0])  # type: ignore[operator]


@pytest.mark.parametrize(
    ("theta", "phi", "message"),
    [
        ([float("nan")], [0.0], "theta"),
        ([0.0], [float("inf")], "phi"),
        ([-1e-6], [0.0], "polar range"),
        ([pi + 1e-6], [0.0], "polar range"),
    ],
)
def test_spherical_harmonics_reject_non_finite_or_out_of_domain_angles(
    theta: list[float], phi: list[float], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        complex_spherical_harmonic(1, 0, theta, phi)


def test_radial_wavefunction_reports_unrepresentable_normalization() -> None:
    with pytest.raises(ValueError, match="normalization cannot be represented"):
        radial_wavefunction(1, 0, [0.0], a_mu=1e-300)


def test_radial_wavefunction_high_precision_fallback_covers_direct_power_boundary() -> None:
    # At this exact float, float.__pow__ raises OverflowError.  The complete 1s
    # normalization includes 1/sqrt(2), so it is finite and must survive.
    a_mu = 6.27893936364686e-205
    radial = radial_wavefunction(1, 0, [0.0], z=10.0, a_mu=a_mu)
    expected_at_origin = 2.0 * (10.0 / a_mu) ** 1.5

    assert radial.shape == (1,)
    assert np.isfinite(radial[0])
    assert radial[0] == pytest.approx(expected_at_origin, rel=2e-13)


def test_radial_wavefunction_accepts_exactly_representable_upper_boundary() -> None:
    radial = radial_wavefunction(1, 0, [0.0], z=np.float32(1.0), a_mu=4.983597475548785e-206)

    assert radial[0].hex() == "0x1.ffffffffffffdp+1023"


def test_radial_wavefunction_rescales_extreme_equal_parameters_before_multiplying() -> None:
    radius = np.asarray([0.0, 1.0])
    radial = radial_wavefunction(1, 0, radius, z=1e308, a_mu=1e308)

    assert radial == pytest.approx(2.0 * np.exp(-radius), rel=2e-15)


def test_hydrogen_ground_state_matches_closed_form() -> None:
    radius = np.asarray([0.0, 0.25, 1.0, 3.0])
    expected = 2.0 * np.exp(-radius)
    assert radial_wavefunction(1, 0, radius) == pytest.approx(expected, rel=1e-13, abs=1e-14)


def test_radial_node_radii_match_laguerre_roots_and_scale_covariantly() -> None:
    assert radial_node_radii(1, 0).size == 0
    assert radial_node_radii(6, 5).size == 0
    assert radial_node_radii(2, 0) == pytest.approx([2.0], rel=1e-14)
    assert radial_node_radii(3, 0) == pytest.approx(
        [1.9019237886466849, 7.098076211353316], rel=1e-14
    )
    assert radial_node_radii(3, 0, z=2.0, a_mu=0.5) == pytest.approx(
        0.25 * radial_node_radii(3, 0), rel=1e-14
    )


def test_radial_node_radii_high_precision_fallback_handles_representable_extreme_ratio() -> None:
    nodes = radial_node_radii(3, 0, z=1e308, a_mu=1e308)

    assert nodes == pytest.approx(radial_node_radii(3, 0), rel=2e-13)
    assert np.all(np.isfinite(nodes))


def test_radial_node_radii_accept_exactly_representable_upper_boundary() -> None:
    nodes = radial_node_radii(2, 0, z=np.float32(1.0), a_mu=8.988465674311579e307)

    assert nodes.tolist() == [np.finfo(np.float64).max]


@pytest.mark.parametrize(
    ("z", "a_mu"),
    [(1e-308, 1e308), (1e308, 1e-308)],
)
def test_radial_node_radii_reject_unrepresentable_extreme_ratios(z: float, a_mu: float) -> None:
    with pytest.raises(ValueError, match="radial node radii cannot be represented in float64"):
        radial_node_radii(3, 0, z=z, a_mu=a_mu)


def test_hydrogenic_density_floor_uses_high_precision_fallback_for_representable_result() -> None:
    floor = hydrogenic_density_floor(z=1e105, a_mu=1.0, relative_floor=1e-14)

    assert np.isfinite(floor)
    assert floor == pytest.approx(1e301, rel=5e-14)


@pytest.mark.parametrize(
    ("a_mu", "expected_hex"),
    [
        (1.7718548704178432e-103, "0x1.ffffffffffffep+1023"),
        (5.8713564569345805e107, "0x0.0000000000001p-1022"),
    ],
)
def test_hydrogenic_density_floor_accepts_representable_float64_boundaries(
    a_mu: float, expected_hex: str
) -> None:
    floor = hydrogenic_density_floor(z=np.float32(1.0), a_mu=a_mu, relative_floor=1.0)

    assert floor.hex() == expected_hex


@pytest.mark.parametrize(
    ("z", "a_mu", "relative_floor"),
    [(1e108, 1.0, 1e-14), (1e-108, 1.0, 1e-14)],
)
def test_hydrogenic_density_floor_rejects_unrepresentable_result(
    z: float, a_mu: float, relative_floor: float
) -> None:
    with pytest.raises(ValueError, match="density floor cannot be represented in float64"):
        hydrogenic_density_floor(z=z, a_mu=a_mu, relative_floor=relative_floor)


def test_radial_functions_are_normalized() -> None:
    radius = np.linspace(0.0, 180.0, 200_001)
    for n, l in [(1, 0), (2, 0), (2, 1), (3, 1), (4, 2)]:
        radial = radial_wavefunction(n, l, radius)
        integral = np.trapezoid(radius * radius * radial * radial, radius)
        assert integral == pytest.approx(1.0, abs=3e-7)


def test_confirmed_3p_and_4d_radial_nodes() -> None:
    # sigma = r/a_mu for Z=1. The audited Manim source placed these nodes at 2 and 3.
    assert float(radial_wavefunction(3, 1, 6.0)) == pytest.approx(0.0, abs=2e-16)
    assert float(radial_wavefunction(4, 2, 12.0)) == pytest.approx(0.0, abs=2e-16)

    assert float(radial_wavefunction(3, 1, 5.9) * radial_wavefunction(3, 1, 6.1)) < 0.0
    assert float(radial_wavefunction(4, 2, 11.9) * radial_wavefunction(4, 2, 12.1)) < 0.0


def test_real_p_harmonics_match_cartesian_directions() -> None:
    theta = np.asarray([pi / 2, pi / 2, 0.0])
    phi = np.asarray([0.0, pi / 2, 0.0])
    scale = np.sqrt(3.0 / (4.0 * pi))

    px = real_spherical_harmonic(1, 1, theta, phi)
    py = real_spherical_harmonic(1, -1, theta, phi)
    pz = real_spherical_harmonic(1, 0, theta, phi)

    assert px == pytest.approx([scale, 0.0, 0.0], abs=2e-15)
    assert py == pytest.approx([0.0, scale, 0.0], abs=2e-15)
    assert pz == pytest.approx([0.0, 0.0, scale], abs=2e-15)


def test_full_wavefunction_is_normalized_on_spherical_grid() -> None:
    radius = np.linspace(0.0, 60.0, 4_001)
    theta = np.linspace(0.0, pi, 801)
    phi = np.linspace(0.0, 2.0 * pi, 1_001)

    # Factorized quadrature avoids a large three-dimensional allocation.
    radial = radial_wavefunction(3, 2, radius)
    radial_mass = np.trapezoid(radius**2 * radial**2, radius)
    angular = hydrogenic_wavefunction(
        3,
        2,
        1,
        np.ones((theta.size, 1)),
        theta[:, None],
        phi[None, :],
        basis=BasisKind.COMPLEX,
    )
    # R(1) appears in angular above, so divide it back out before integrating.
    angular_density = probability_density(angular) / float(radial_wavefunction(3, 2, 1.0) ** 2)
    angular_mass = np.trapezoid(np.trapezoid(angular_density, phi, axis=1) * np.sin(theta), theta)
    assert radial_mass * angular_mass == pytest.approx(1.0, abs=3e-5)


def test_stationary_complex_state_can_have_nonzero_current() -> None:
    current = probability_current_hydrogenic(
        2,
        1,
        1,
        r=np.asarray([2.0]),
        theta=np.asarray([pi / 2]),
        phi=np.asarray([0.0]),
        basis=BasisKind.COMPLEX,
    )
    assert current.shape == (1, 3)
    assert current[0, 0] == pytest.approx(0.0, abs=1e-15)
    assert current[0, 1] > 0.0
    assert current[0, 2] == pytest.approx(0.0, abs=1e-15)

    real_current = probability_current_hydrogenic(
        2,
        1,
        1,
        r=np.asarray([2.0]),
        theta=np.asarray([pi / 2]),
        phi=np.asarray([0.0]),
        basis=BasisKind.REAL,
    )
    assert np.all(real_current == 0.0)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"n": 1.5}, "integer"),
        ({"n": True}, "integer"),
        ({"z": float("nan")}, "z must be positive and finite"),
        ({"z": float("inf")}, "z must be positive and finite"),
        ({"a_mu": float("nan")}, "a_mu must be positive and finite"),
        ({"density_floor": float("nan")}, "density_floor must be non-negative and finite"),
        ({"r": np.asarray([-1.0])}, "r must be non-negative"),
    ],
)
def test_analytic_zero_current_branches_still_validate_the_public_contract(
    overrides: dict[str, object], message: str
) -> None:
    arguments: dict[str, object] = {
        "n": 1,
        "l": 0,
        "m": 0,
        "r": np.asarray([1.0]),
        "theta": np.asarray([0.0]),
        "phi": np.asarray([0.0]),
        "basis": BasisKind.REAL,
        **overrides,
    }

    with pytest.raises(ValueError, match=message):
        probability_current_hydrogenic(**arguments)  # type: ignore[arg-type]


def test_probability_current_default_floor_is_coulomb_scale_covariant() -> None:
    reference = probability_current_hydrogenic(
        2,
        1,
        1,
        r=np.asarray([4.0]),
        theta=np.asarray([pi / 2]),
        phi=np.asarray([0.0]),
        basis=BasisKind.COMPLEX,
    )

    diffuse_z = 1e-4
    diffuse = probability_current_hydrogenic(
        2,
        1,
        1,
        r=np.asarray([4.0 / diffuse_z]),
        theta=np.asarray([pi / 2]),
        phi=np.asarray([0.0]),
        z=diffuse_z,
        basis=BasisKind.COMPLEX,
    )
    contracted_a_mu = 0.2
    contracted = probability_current_hydrogenic(
        2,
        1,
        1,
        r=np.asarray([4.0 * contracted_a_mu]),
        theta=np.asarray([pi / 2]),
        phi=np.asarray([0.0]),
        a_mu=contracted_a_mu,
        basis=BasisKind.COMPLEX,
    )

    assert np.linalg.norm(diffuse) > 0.0
    assert diffuse == pytest.approx(diffuse_z**4 * reference, rel=2e-13, abs=0.0)
    assert contracted == pytest.approx(reference / contracted_a_mu**3, rel=2e-13, abs=0.0)


def test_hydrogenic_energy_scaling() -> None:
    assert hydrogenic_energy_hartree(1) == pytest.approx(-0.5)
    assert hydrogenic_energy_hartree(2, z=2.0) == pytest.approx(-0.5)
