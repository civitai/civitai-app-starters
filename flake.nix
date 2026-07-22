{
  description = "Dev shell for civitai-app-starters — Node 24 + pnpm 10.28.1 (via corepack)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachSystem [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ] (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          # Node 24 is the current Active LTS (even release, LTS since Oct 2025)
          # and satisfies engines.node ">=20". Node 20 is EOL/insecure and Node 22
          # is Maintenance LTS; the repo's release workflow already publishes on
          # Node 24, so the whole dev/CI/flake toolchain is unified on it here.
          # corepack ships with nodejs and pins the EXACT pnpm from package.json's
          # "packageManager" field (pnpm@10.28.1).
          packages = [
            pkgs.nodejs_24
            pkgs.corepack_24
          ];

          shellHook = ''
            # pkgs.corepack ships a `pnpm` shim that reads package.json's
            # "packageManager" field and transparently uses the pinned version
            # (pnpm@10.28.1), downloading + caching it under COREPACK_HOME on
            # first use. Nothing else to activate.
            echo "civitai-app-starters dev shell"
            echo "  node: $(node --version)"
            echo "  pnpm: $(pnpm --version)"
          '';
        };
      });
}
