import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const alt = 'Thumbnail Battle - Can You Spot the Winner?';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 128,
          background: 'linear-gradient(135deg, #0a0e1a 0%, #1a1f2e 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* Grid background */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: 
              'linear-gradient(rgba(0, 255, 0, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 0, 0.03) 1px, transparent 1px)',
            backgroundSize: '50px 50px',
          }}
        />
        
        {/* Content */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10 }}>
          {/* Axe emoji */}
          <div style={{ fontSize: 120, marginBottom: 20 }}>🪓</div>
          
          {/* Title */}
          <h1
            style={{
              fontSize: 72,
              fontWeight: 900,
              color: 'white',
              margin: 0,
              letterSpacing: -2,
              textShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
            }}
          >
            Thumbnail Battle
          </h1>
          
          {/* Subtitle */}
          <div
            style={{
              fontSize: 32,
              color: '#00ff00',
              margin: '20px 0',
              fontWeight: 600,
            }}
          >
            Can You Spot the Winner?
          </div>
          
          {/* VS Container */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 40, margin: '40px 0' }}>
            <div
              style={{
                width: 300,
                height: 169,
                background: '#2a2f3e',
                borderRadius: 12,
                border: '3px solid rgba(0, 255, 0, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 60,
                color: 'rgba(0, 255, 0, 0.3)',
                fontWeight: 'bold',
              }}
            >
              ?
            </div>
            
            <div
              style={{
                fontSize: 48,
                fontWeight: 'bold',
                color: '#00ff00',
                textShadow: '0 0 20px rgba(0, 255, 0, 0.5)',
              }}
            >
              VS
            </div>
            
            <div
              style={{
                width: 300,
                height: 169,
                background: '#2a2f3e',
                borderRadius: 12,
                border: '3px solid rgba(0, 255, 0, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 60,
                color: 'rgba(0, 255, 0, 0.3)',
                fontWeight: 'bold',
              }}
            >
              ?
            </div>
          </div>
          
          {/* Description */}
          <div
            style={{
              fontSize: 24,
              color: 'rgba(255, 255, 255, 0.8)',
              margin: '20px 0',
              maxWidth: 800,
              textAlign: 'center',
            }}
          >
            Test your YouTube instincts! Pick which video beat the channel average.
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}