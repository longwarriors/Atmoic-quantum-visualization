/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Written by `npm run codegen` (web/scripts/generate-api-types.mjs) from
 * tests/fixtures/openapi.json, which is itself written from the live FastAPI
 * app by `uv run python scripts/write_openapi.py`.
 *
 * To change anything here, change the API in src/quviz/api/, then rerun both
 * generators. src/api/schema.gen.test.ts regenerates this file from the
 * fixture and fails on any difference, so an edit made here by hand does not
 * survive `npm test`.
 */

export interface paths {
    "/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Root */
        get: operations["root__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_api_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/orbitals/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Orbital Catalog
         * @description Curated presets that have immediately recognizable geometry.
         */
        get: operations["orbital_catalog_api_orbitals_catalog_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/orbitals/current-field": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Current Field
         * @description Probability-flow streamlines.
         *
         *     Real stationary orbitals have zero current; the payload is then empty and
         *     carries a warning rather than an error, because "no flow" is the physically
         *     correct answer rather than a failure.
         */
        get: operations["current_field_api_orbitals_current_field_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/orbitals/isosurface": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Isosurface */
        get: operations["isosurface_api_orbitals_isosurface_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/orbitals/metadata": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Metadata */
        get: operations["metadata_api_orbitals_metadata_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/orbitals/point-cloud": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Point Cloud */
        get: operations["point_cloud_api_orbitals_point_cloud_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/orbitals/slice": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Orbital Slice
         * @description One scalar field of an eigenstate on a principal plane through the origin.
         *
         *     The extent is derived from the state and reported; it is not a parameter.
         *     ``resolution`` is bounded here only by the outermost limits both payloads
         *     share -- the parity rule and the ``n``-dependent floor live in the builder,
         *     which raises, and those refusals arrive as a 422 naming the reason.
         *
         *     This is the only eigenstate route that exposes ``a_mu``: a slice is where
         *     the reduced-mass length is legible, because it rescales both the derived
         *     extent and the amplitude scale the phase mask is referenced to.
         */
        get: operations["orbital_slice_api_orbitals_slice_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/superposition/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Superposition Catalog
         * @description Presets chosen to make the physics legible, including a negative control.
         */
        get: operations["superposition_catalog_api_superposition_catalog_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/superposition/current-field": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Superposition Current Field
         * @description Probability-flow streamlines of a superposition, with its continuity residual.
         */
        get: operations["superposition_current_field_api_superposition_current_field_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/superposition/isosurface": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Superposition Isosurface
         * @description The :math:`|\Psi(t)|^2` level set of a superposition at one instant.
         */
        get: operations["superposition_isosurface_api_superposition_isosurface_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/superposition/slice": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Superposition Slice
         * @description One scalar field of a superposition on a principal plane at one instant.
         *
         *     The largest term sets both the extent and the resolution floor, so a
         *     resolution that is honest for a 1s slice can be refused here; the refusal
         *     names the shell that demands more samples.
         */
        get: operations["superposition_slice_api_superposition_slice_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * BasisKind
         * @description Angular basis used to represent hydrogenic states.
         * @enum {string}
         */
        BasisKind: "complex" | "real";
        /**
         * CurrentFieldPayload
         * @description Probability-flow streamlines with the numbers needed to judge them.
         *
         *     Geometry and magnitude stay separate: vertices are evenly spaced in arc
         *     length, and ``speed`` carries |j|/rho per vertex. Rendering must not encode
         *     speed as spacing, or the picture would show the same quantity twice.
         */
        CurrentFieldPayload: {
            /** Arc Step Bohr */
            arc_step_bohr: number;
            /** Continuity Absolute Residual */
            continuity_absolute_residual: number;
            /** Continuity Probe Count */
            continuity_probe_count: number;
            /** Continuity Residual */
            continuity_residual: number;
            /** Continuity Scale */
            continuity_scale: number;
            /**
             * Continuity Scale Kind
             * @enum {string}
             */
            continuity_scale_kind: "stationary_current" | "analytic_zero_current";
            /** Extent Bohr */
            extent_bohr: number;
            /**
             * Integration Rule
             * @default rk4_arc_length
             */
            integration_rule: string;
            /** Lines */
            lines: number[][][];
            /** Max Speed */
            max_speed: number;
            metadata: components["schemas"]["OrbitalMetadata"];
            /** Seed Count */
            seed_count: number;
            /** Seed Density Floor */
            seed_density_floor: number;
            /** Speed */
            speed: number[][];
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /**
         * IsosurfacePayload
         * @description Indexed mesh with per-vertex phase for GPU coloring.
         */
        IsosurfacePayload: {
            /** Captured Probability Mass */
            captured_probability_mass: number;
            /** Density Level */
            density_level: number;
            /** Extent Bohr */
            extent_bohr: number;
            /** Faces */
            faces: number[][];
            /** Finite Grid Density Integral */
            finite_grid_density_integral: number;
            /** Grid Resolution */
            grid_resolution: number;
            /** Grid Spacing Bohr */
            grid_spacing_bohr: number;
            /**
             * Integration Rule
             * @default tensor_product_simpson
             */
            integration_rule: string;
            metadata: components["schemas"]["OrbitalMetadata"];
            /** Normals */
            normals: number[][];
            /** Phase */
            phase: number[];
            /** Requested Probability Mass */
            requested_probability_mass: number;
            /** Vertices */
            vertices: number[][];
        };
        /**
         * ObservableKind
         * @description Physical quantity represented by a scene asset.
         * @enum {string}
         */
        ObservableKind: "wavefunction" | "probability_density" | "phase" | "probability_current";
        /**
         * OrbitalMetadata
         * @description Metadata that keeps physical semantics attached to rendered data.
         */
        OrbitalMetadata: {
            /** Color Semantics */
            color_semantics: string;
            /** Coordinate Convention */
            coordinate_convention: string;
            /** Energy Hartree */
            energy_hartree: number;
            /** Geometry Semantics */
            geometry_semantics: string;
            /** Label */
            label: string;
            /**
             * Length Unit
             * @default bohr
             */
            length_unit: string;
            /**
             * Normalization
             * @default integral(|psi|^2 dV)=1
             */
            normalization: string;
            observable: components["schemas"]["ObservableKind"];
            /** References */
            references: string[];
            representation: components["schemas"]["RepresentationKind"];
            /** Spherical Harmonic Convention */
            spherical_harmonic_convention: string;
            state: components["schemas"]["QuantumStateSpec"];
            /** Warnings */
            warnings?: string[];
        };
        /**
         * PrincipalPlane
         * @description Cartesian plane through the origin on which a slice is sampled.
         *
         *     Each member names its in-plane axes in ``(u, v)`` order; the frames
         *     themselves, including the right-handed ``xz`` normal ``-y``, live in
         *     :mod:`quviz.physics.planes`.
         * @enum {string}
         */
        PrincipalPlane: "xy" | "xz" | "yz";
        /**
         * QuantumStateSpec
         * @description A reproducible hydrogenic state specification.
         */
        QuantumStateSpec: {
            /**
             * A Mu
             * @default 1
             */
            a_mu: number;
            /** @default real */
            basis: components["schemas"]["BasisKind"];
            /** L */
            l: number;
            /** M */
            m: number;
            /** N */
            n: number;
            /**
             * Z
             * @default 1
             */
            z: number;
        };
        /**
         * RepresentationKind
         * @description Rendering representation, deliberately separate from the observable.
         * @enum {string}
         */
        RepresentationKind: "point_cloud" | "isosurface" | "slice" | "streamlines";
        /**
         * SliceObservable
         * @description Scalar field a slice reports on its plane.
         *
         *     This is deliberately narrower than :class:`ObservableKind`: a slice carries
         *     real and imaginary wavefunction components as separate fields, and it has no
         *     slice representation of a vector-valued probability current.
         * @enum {string}
         */
        SliceObservable: "probability_density" | "wavefunction_real" | "wavefunction_imag" | "phase";
        /**
         * SlicePayload
         * @description A plane section of one eigenstate's scalar field.
         */
        SlicePayload: {
            /** Extent Bohr */
            extent_bohr: number;
            /**
             * Layout
             * @default row_major_v_rows_u_columns
             * @constant
             */
            layout: "row_major_v_rows_u_columns";
            /**
             * Length Unit
             * @default bohr
             */
            length_unit: string;
            /**
             * Masked Value Sentinel
             * @default 0
             */
            masked_value_sentinel: number;
            /** Max Amplitude On Plane */
            max_amplitude_on_plane: number;
            metadata: components["schemas"]["OrbitalMetadata"];
            /** Normal */
            normal: number[];
            /** Origin Bohr */
            origin_bohr: number[];
            /** Phase Mask Amplitude Scale */
            phase_mask_amplitude_scale?: number | null;
            /** Phase Mask Amplitude Threshold */
            phase_mask_amplitude_threshold?: number | null;
            /** Phase Mask Numeric Floor */
            phase_mask_numeric_floor?: number | null;
            /** Phase Mask Relative Amplitude */
            phase_mask_relative_amplitude?: number | null;
            /** Phase Masked Fraction */
            phase_masked_fraction?: number | null;
            plane: components["schemas"]["PrincipalPlane"];
            /** Resolution */
            resolution: number;
            slice_observable: components["schemas"]["SliceObservable"];
            /** Spacing Bohr */
            spacing_bohr: number;
            /** U Axis */
            u_axis: number[];
            /** V Axis */
            v_axis: number[];
            /** Valid Mask */
            valid_mask?: boolean[] | null;
            /** Value Unit */
            value_unit: string;
            /** Values */
            values: number[];
        };
        /**
         * SuperpositionCatalogEntry
         * @description One client-ready preset, including its builder-derived capabilities.
         */
        SuperpositionCatalogEntry: {
            /** Id */
            id: string;
            /** Label */
            label: string;
            /** Note */
            note: string;
            /** Period Au */
            period_au: number;
            /**
             * Slice Resolution Floor
             * @description First odd uniform grid accepted by the superposition slice builder for this preset; independent of Z and a_mu because all relevant lengths scale together.
             */
            slice_resolution_floor: number;
            /**
             * Streamline Seed Count Max
             * @description Largest seed_count accepted by both superposition current-field workload guards for this preset in either basis at the route-default arc_step; independent of Z and a_mu because the extent and default arc step scale together.
             */
            streamline_seed_count_max: number;
            /** Terms */
            terms: string;
        };
        /**
         * SuperpositionCurrentPayload
         * @description Probability-flow streamlines of a superposition at one instant.
         *
         *     For a non-stationary state, ``continuity_residual`` is the full statement
         *     ``d(rho)/dt + div j = 0``, normalized by a time-independent root-sum-square
         *     transition-coherence reference and audited at four phases of every
         *     distinct energy gap. A stationary non-zero flow instead uses
         *     ``max|j| / L_d``; a spatial
         *     state proved real up to global phase reports analytic zero with no probes
         *     or phase samples. ``density_rate_scale`` remains the instantaneous value
         *     for transparency, but is never the non-stationary denominator.
         */
        SuperpositionCurrentPayload: {
            /** Arc Step Bohr */
            arc_step_bohr: number;
            /** Continuity Absolute Residual */
            continuity_absolute_residual: number;
            /** Continuity Phase Count */
            continuity_phase_count: number;
            /** Continuity Probe Count */
            continuity_probe_count: number;
            /** Continuity Residual */
            continuity_residual: number;
            /** Continuity Scale */
            continuity_scale: number;
            /**
             * Continuity Scale Kind
             * @enum {string}
             */
            continuity_scale_kind: "transition_coherence" | "stationary_current" | "analytic_zero_current";
            /** Density Rate Scale */
            density_rate_scale: number;
            /** Extent Bohr */
            extent_bohr: number;
            /**
             * Integration Rule
             * @default rk4_arc_length
             */
            integration_rule: string;
            /** Lines */
            lines: number[][][];
            /** Max Speed */
            max_speed: number;
            metadata: components["schemas"]["SuperpositionMetadata"];
            /** Seed Count */
            seed_count: number;
            /** Seed Density Floor */
            seed_density_floor: number;
            /** Speed */
            speed: number[][];
        };
        /**
         * SuperpositionIsosurfacePayload
         * @description A |Psi|^2 isosurface at one instant.
         */
        SuperpositionIsosurfacePayload: {
            /** Captured Probability Mass */
            captured_probability_mass: number;
            /** Density Level */
            density_level: number;
            /** Extent Bohr */
            extent_bohr: number;
            /** Faces */
            faces: number[][];
            /** Finite Box Mass Variation Upper Bound */
            finite_box_mass_variation_upper_bound: number;
            /** Finite Box Tail Mass Upper Bound */
            finite_box_tail_mass_upper_bound: number;
            /** Finite Grid Aliasing Variation Lower Bound */
            finite_grid_aliasing_variation_lower_bound: number;
            /** Finite Grid Density Integral */
            finite_grid_density_integral: number;
            /** Finite Grid Mass Error Lower Bound */
            finite_grid_mass_error_lower_bound: number;
            /**
             * Finite Grid Mass Status
             * @enum {string}
             */
            finite_grid_mass_status: "no_error_above_tolerance_proven" | "phase_dependent_quadrature_error" | "time_invariant_quadrature_error" | "quadrature_error_at_reported_time";
            /** Finite Grid Phase Variation Bound */
            finite_grid_phase_variation_bound: number;
            /** Finite Grid Reporting Tolerance */
            finite_grid_reporting_tolerance: number;
            /** Grid Resolution */
            grid_resolution: number;
            /** Grid Spacing Bohr */
            grid_spacing_bohr: number;
            /**
             * Integration Rule
             * @default tensor_product_simpson
             */
            integration_rule: string;
            metadata: components["schemas"]["SuperpositionMetadata"];
            /** Normals */
            normals: number[][];
            /** Phase */
            phase: number[];
            /** Requested Probability Mass */
            requested_probability_mass: number;
            /** Vertices */
            vertices: number[][];
        };
        /**
         * SuperpositionMetadata
         * @description Metadata for a time-dependent superposition.
         *
         *     Deliberately not an ``OrbitalMetadata``: a superposition has no single
         *     ``(n, l, m)``, and forcing one would make the contract claim a state the
         *     asset is not showing. The coefficients and the time are part of the
         *     physical identity here, so they are required fields.
         */
        SuperpositionMetadata: {
            /** A Mu */
            a_mu: number;
            basis: components["schemas"]["BasisKind"];
            /** Color Semantics */
            color_semantics: string;
            /** Coordinate Convention */
            coordinate_convention: string;
            /** Energy Expectation Hartree */
            energy_expectation_hartree: number;
            /** Geometry Semantics */
            geometry_semantics: string;
            /** Is Stationary */
            is_stationary: boolean;
            /** Label */
            label: string;
            /**
             * Length Unit
             * @default bohr
             */
            length_unit: string;
            /**
             * Normalization
             * @default sum |c_k|^2 = 1 with orthonormal psi_k
             */
            normalization: string;
            observable: components["schemas"]["ObservableKind"];
            /** Reduced Mass Ratio */
            reduced_mass_ratio: number;
            /** References */
            references: string[];
            representation: components["schemas"]["RepresentationKind"];
            /** Spherical Harmonic Convention */
            spherical_harmonic_convention: string;
            /** Terms */
            terms: components["schemas"]["SuperpositionTermSpec"][];
            /** Time Au */
            time_au: number;
            /** Warnings */
            warnings?: string[];
            /** Z */
            z: number;
        };
        /**
         * SuperpositionSlicePayload
         * @description A plane section of a superposition's scalar field at one instant.
         *
         *     Separate from :class:`SlicePayload` for the same reason the isosurface pair
         *     is separate: a superposition has no single ``(n, l, m)``, so its metadata is
         *     a different type, and only the metadata differs.
         */
        SuperpositionSlicePayload: {
            /** Extent Bohr */
            extent_bohr: number;
            /**
             * Layout
             * @default row_major_v_rows_u_columns
             * @constant
             */
            layout: "row_major_v_rows_u_columns";
            /**
             * Length Unit
             * @default bohr
             */
            length_unit: string;
            /**
             * Masked Value Sentinel
             * @default 0
             */
            masked_value_sentinel: number;
            /** Max Amplitude On Plane */
            max_amplitude_on_plane: number;
            metadata: components["schemas"]["SuperpositionMetadata"];
            /** Normal */
            normal: number[];
            /** Origin Bohr */
            origin_bohr: number[];
            /** Phase Mask Amplitude Scale */
            phase_mask_amplitude_scale?: number | null;
            /** Phase Mask Amplitude Threshold */
            phase_mask_amplitude_threshold?: number | null;
            /** Phase Mask Numeric Floor */
            phase_mask_numeric_floor?: number | null;
            /** Phase Mask Relative Amplitude */
            phase_mask_relative_amplitude?: number | null;
            /** Phase Masked Fraction */
            phase_masked_fraction?: number | null;
            plane: components["schemas"]["PrincipalPlane"];
            /** Resolution */
            resolution: number;
            slice_observable: components["schemas"]["SliceObservable"];
            /** Spacing Bohr */
            spacing_bohr: number;
            /** U Axis */
            u_axis: number[];
            /** V Axis */
            v_axis: number[];
            /** Valid Mask */
            valid_mask?: boolean[] | null;
            /** Value Unit */
            value_unit: string;
            /** Values */
            values: number[];
        };
        /**
         * SuperpositionTermSpec
         * @description One eigenstate and its complex amplitude, JSON-serialisable.
         */
        SuperpositionTermSpec: {
            /**
             * Coefficient Imag
             * @default 0
             */
            coefficient_imag: number;
            /** Coefficient Real */
            coefficient_real: number;
            /** L */
            l: number;
            /** M */
            m: number;
            /** N */
            n: number;
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    root__get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    health_api_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    orbital_catalog_api_orbitals_catalog_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
        };
    };
    current_field_api_orbitals_current_field_get: {
        parameters: {
            query?: {
                n?: number;
                l?: number;
                m?: number;
                z?: number;
                basis?: components["schemas"]["BasisKind"];
                seed_count?: number;
                arc_step?: number | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CurrentFieldPayload"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    isosurface_api_orbitals_isosurface_get: {
        parameters: {
            query?: {
                n?: number;
                l?: number;
                m?: number;
                z?: number;
                basis?: components["schemas"]["BasisKind"];
                resolution?: number;
                probability_mass?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IsosurfacePayload"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    metadata_api_orbitals_metadata_get: {
        parameters: {
            query?: {
                n?: number;
                l?: number;
                m?: number;
                z?: number;
                basis?: components["schemas"]["BasisKind"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrbitalMetadata"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    point_cloud_api_orbitals_point_cloud_get: {
        parameters: {
            query?: {
                n?: number;
                l?: number;
                m?: number;
                z?: number;
                basis?: components["schemas"]["BasisKind"];
                samples?: number;
                seed?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    orbital_slice_api_orbitals_slice_get: {
        parameters: {
            query?: {
                n?: number;
                l?: number;
                m?: number;
                z?: number;
                a_mu?: number;
                basis?: components["schemas"]["BasisKind"];
                plane?: components["schemas"]["PrincipalPlane"];
                observable?: components["schemas"]["SliceObservable"];
                resolution?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SlicePayload"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    superposition_catalog_api_superposition_catalog_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SuperpositionCatalogEntry"][];
                };
            };
        };
    };
    superposition_current_field_api_superposition_current_field_get: {
        parameters: {
            query?: {
                /** @description semicolon-separated terms 'n,l,m,re[,im]', e.g. '1,0,0,0.70710678;2,1,0,0.70710678' */
                terms?: string;
                time?: number;
                basis?: components["schemas"]["BasisKind"];
                z?: number;
                a_mu?: number;
                seed_count?: number;
                arc_step?: number | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SuperpositionCurrentPayload"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    superposition_isosurface_api_superposition_isosurface_get: {
        parameters: {
            query?: {
                /** @description semicolon-separated terms 'n,l,m,re[,im]', e.g. '1,0,0,0.70710678;2,1,0,0.70710678' */
                terms?: string;
                time?: number;
                basis?: components["schemas"]["BasisKind"];
                z?: number;
                a_mu?: number;
                resolution?: number;
                probability_mass?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SuperpositionIsosurfacePayload"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    superposition_slice_api_superposition_slice_get: {
        parameters: {
            query?: {
                /** @description semicolon-separated terms 'n,l,m,re[,im]', e.g. '1,0,0,0.70710678;2,1,0,0.70710678' */
                terms?: string;
                time?: number;
                basis?: components["schemas"]["BasisKind"];
                z?: number;
                a_mu?: number;
                plane?: components["schemas"]["PrincipalPlane"];
                observable?: components["schemas"]["SliceObservable"];
                resolution?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SuperpositionSlicePayload"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
