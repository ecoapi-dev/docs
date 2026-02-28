import { useState, useEffect } from 'react';
import { motion as Motion } from 'motion/react';
import { Menu, X } from 'lucide-react';
import { useTheme } from '../theme-context';

const navLinks = ['About', 'Features', 'Contact'];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <Motion.nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'backdrop-blur-md shadow-lg shadow-black/10'
          : 'bg-transparent'
      }`}
      style={{ backgroundColor: scrolled ? `${theme.bg}cc` : 'transparent' }}
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.2 }}
    >
      <div className="max-w-7xl mx-auto px-6 md:px-10 flex items-center justify-between h-16 md:h-20">
        <a
          href="#"
          className="transition-colors"
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: '1.4rem',
            fontWeight: 700,
            letterSpacing: '0.03em',
            color: '#ffffff'
          }}
        >
          EcoApi
        </a>

        <div className="hidden md:flex items-center gap-10">
          {navLinks.map((link) => (
            <a
              key={link}
              href={`#${link.toLowerCase()}`}
              className="transition-colors"
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: '0.875rem',
                fontWeight: 400,
                letterSpacing: '0.05em',
                color: theme.id === 'purple' ? 'rgba(255,255,255,0.6)' : theme.textTagline
              }}
            >
              {link}
            </a>
          ))}
        </div>

        <button
          className="md:hidden transition-colors"
          style={{ color: theme.id === 'purple' ? 'rgba(255,255,255,0.7)' : theme.textTagline }}
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {mobileOpen && (
        <Motion.div
          className="md:hidden backdrop-blur-md border-t border-white/5"
          style={{ backgroundColor: `${theme.bg}f2` }}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.3 }}
        >
          <div className="px-6 py-4 flex flex-col gap-4">
            {navLinks.map((link) => (
              <a
                key={link}
                href={`#${link.toLowerCase()}`}
                className="text-white/60 hover:text-white transition-colors py-2"
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: '0.95rem',
                  fontWeight: 400,
                  letterSpacing: '0.05em',
                }}
                onClick={() => setMobileOpen(false)}
              >
                {link}
              </a>
            ))}
          </div>
        </Motion.div>
      )}
    </Motion.nav>
  );
}
