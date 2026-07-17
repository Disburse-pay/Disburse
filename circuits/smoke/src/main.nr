// Minimal circuit to validate the Noir + Barretenberg toolchain on a fresh VPS
// before building the heavier `revenue` circuit. Proves knowledge of a square
// root `x` of the public `y`.
fn main(x: Field, y: pub Field) {
    assert(x * x == y);
}

#[test]
fn test_smoke() {
    main(3, 9);
}
