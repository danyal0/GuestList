'use client';

import { motion } from 'framer-motion';
import { BrandLogo } from '@/components/brand/brand-logo';

export function AuthCard({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center py-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
        className="glass rounded-[var(--radius-xl)] p-8"
      >
        <div className="mb-5 flex justify-center">
          <BrandLogo size="xl" priority className="h-[72px] w-[72px] rounded-2xl shadow-sm" />
        </div>
        <h1 className="text-center text-[26px] font-extrabold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 text-center text-[15px] text-[var(--color-ink-secondary)]">{subtitle}</p>
        )}
        <div className="mt-6">{children}</div>
      </motion.div>
    </div>
  );
}
