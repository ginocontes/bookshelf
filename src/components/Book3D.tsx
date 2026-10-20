import { useState, type CSSProperties } from 'react';
import { motion, useMotionValue, useTransform, type MotionValue } from 'motion/react';
import { type Book, coverWidth, surname } from '../lib/books';
import { isLight, shade, useSpineColor } from '../lib/color';

type Props = {
  book: Book;
  /** Screen pixels per base pixel. */
  scale: number;
  /** Rotation around the vertical axis: 90 shows the spine, 0 the front cover. */
  angle: number | MotionValue<number>;
  lifted?: boolean;
  style?: CSSProperties;
};

/**
 * A book as a real CSS 3D box (front, back, spine, page edges and top). The
 * box is pushed back as it turns so that whichever face points at the viewer
 * sits flush with the shelf, which keeps the spine and cover views pixel-aligned.
 */
export function Book3D({ book, scale, angle, lifted, style }: Props) {
  const h = book.height * scale;
  const w = coverWidth(book) * scale;
  const t = book.thickness * scale;
  const color = useSpineColor(book.slug, book.color, book.cover);

  const depth = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return -((t / 2) * Math.abs(Math.cos(r)) + (w / 2) * Math.abs(Math.sin(r)));
  };
  const placeholder = useMotionValue(0);
  const isMotion = typeof angle !== 'number';
  const animatedZ = useTransform(isMotion ? angle : placeholder, depth);

  return (
    <motion.div
      className={`book3d${lifted ? ' lifted' : ''}`}
      style={{
        ...style,
        width: w,
        height: h,
        rotateY: angle,
        z: isMotion ? animatedZ : depth(angle),
      }}
    >
      <div className="face front" style={{ width: w, height: h, transform: `translateZ(${t / 2}px)` }}>
        <BookCover book={book} color={color} />
      </div>
      <div
        className="face back"
        style={{ width: w, height: h, background: shade(color, -0.25), transform: `rotateY(180deg) translateZ(${t / 2}px)` }}
      />
      <div
        className="face spine-face"
        style={{ width: t, height: h, left: (w - t) / 2, transform: `rotateY(-90deg) translateZ(${w / 2}px)` }}
      >
        <BookSpine book={book} color={color} width={t} />
      </div>
      <div
        className="face pages"
        style={{
          width: t - 2,
          height: h - 4,
          top: 2,
          left: (w - t) / 2 + 1,
          transform: `rotateY(90deg) translateZ(${w / 2 - 1.5}px)`,
        }}
      />
      <div
        className="face pages top"
        style={{ width: w - 3, height: t - 2, top: (h - t) / 2 + 1, transform: `rotateX(90deg) translateZ(${h / 2 - 1.5}px)` }}
      />
    </motion.div>
  );
}

export function BookCover({ book, color }: { book: Book; color: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = book.cover && !failed;
  const light = isLight(color);

  return (
    <div className="cover" style={{ background: color }}>
      {showImage ? (
        <img src={book.cover} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className={`cover-generated${light ? ' on-light' : ''}`}>
          <div className="cover-frame">
            <span className="cover-title">{book.title}</span>
            <span className="cover-rule" />
            {book.author && <span className="cover-author">{book.author}</span>}
          </div>
        </div>
      )}
      <div className="cover-hinge" />
    </div>
  );
}

export function BookSpine({ book, color, width }: { book: Book; color: string; width: number }) {
  const light = isLight(color);
  const titleSize = Math.max(6, Math.min(15, width * 0.4));

  return (
    <div
      className={`spine${light ? ' on-light' : ''}`}
      style={{
        background: `linear-gradient(90deg, ${shade(color, -0.4)} 0%, ${shade(color, 0.14)} 14%, ${color} 42%, ${shade(color, -0.12)} 82%, ${shade(color, -0.38)} 100%)`,
      }}
    >
      <span className="spine-band" />
      <span className="spine-title" style={{ fontSize: titleSize }}>
        {book.title}
      </span>
      <span className="spine-author" style={{ fontSize: titleSize * 0.72 }}>
        {surname(book)}
      </span>
      <span className="spine-band" />
    </div>
  );
}
