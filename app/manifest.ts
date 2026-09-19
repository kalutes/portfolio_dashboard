import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Portfolio",
    short_name: "Portfolio",
    description: "Your private investment portfolio",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b111d",
    theme_color: "#0b111d",
    icons: [
      {
        src: "/icons/portfolio-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/portfolio-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/portfolio-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
