// Metro resolves font files to an asset module id.
declare module '*.ttf' {
  const asset: number;
  export default asset;
}
