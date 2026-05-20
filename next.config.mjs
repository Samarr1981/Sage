/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  serverExternalPackages: [
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
}
export default nextConfig