{
  description = "Dev shell for civitai-app-starters — Node 22 + pnpm 10.28.1 (via corepack)";

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
          # Node 22 (current LTS) satisfies engines.node ">=20" and the repo's
          # release workflow already publishes on Node 24. .nvmrc/CI pin Node 20,
          # but Node 20 is EOL and marked insecure in current nixpkgs, so we use
          # the nearest secure LTS that meets the engines constraint.
          # corepack ships with nodejs and pins the EXACT pnpm from package.json's
          # "packageManager" field (pnpm@10.28.1).
          packages = [
            pkgs.nodejs_22
            pkgs.corepack_22
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
