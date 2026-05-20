/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverComponentsExternalPackages: [
      '@langchain/langgraph',
      '@langchain/core',
      '@supabase/supabase-js',
      '@supabase/ssr',
      '@supabase/realtime-js',
      '@supabase/auth-js',
      '@supabase/storage-js',
      '@supabase/postgrest-js',
      '@supabase/phoenix',
    ],
  },
}

export default nextConfig