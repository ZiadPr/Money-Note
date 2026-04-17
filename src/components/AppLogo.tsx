interface AppLogoProps {
  size?: number;
  className?: string;
}

export default function AppLogo({ size = 48, className = '' }: AppLogoProps) {
  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <div
        className="absolute inset-0 rounded-[31%] shadow-[0_20px_45px_rgba(27,116,228,0.28)]"
        style={{
          background:
            'linear-gradient(180deg, #5aa3ff 0%, #1b74e4 48%, #1457c7 100%)',
        }}
      />
      <div className="absolute inset-[10%] rounded-[28%] bg-white/10" />
      <div className="absolute inset-[15%] rounded-[25%] border border-white/10" />

      <div className="absolute start-[22%] top-[28%] h-[18%] w-[56%] rounded-full bg-white/95 shadow-[0_10px_20px_rgba(15,23,42,0.14)]" />
      <div className="absolute start-[19%] top-[41%] h-[28%] w-[62%] rounded-[34%] bg-white shadow-[0_12px_26px_rgba(15,23,42,0.2)]" />
      <div className="absolute end-[23%] top-[49%] h-[10%] w-[10%] rounded-full bg-[#1b74e4]/22" />
      <div className="absolute start-[27%] top-[34%] h-[5%] w-[24%] rounded-full bg-[#d9ebff]" />
    </div>
  );
}
