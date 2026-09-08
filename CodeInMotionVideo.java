import javax.imageio.ImageIO;
import javax.sound.sampled.*;
import java.awt.*;
import java.awt.geom.*;
import java.awt.image.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class CodeInMotionVideo {
    static final int W = 506, H = 898, FPS = 30;
    static final double DURATION = 36.8;
    static final int[] BARS = {4, 2, 1, 5, 6, 2, 3};
    static final Color INK = new Color(24, 34, 45), MUTED = new Color(102, 119, 135);
    static final Color CYAN = new Color(20, 179, 218), GREEN = new Color(29, 183, 94);
    static final Color PINK = new Color(241, 91, 133), GRID = new Color(222, 232, 238);
    static final Font SANS = new Font("SansSerif", Font.PLAIN, 12);
    static final Font MONO = new Font("Monospaced", Font.PLAIN, 11);

    record Step(double start, double end, int index, int left, String note, int codeLine) {}
    static final Step[] STEPS = {
        new Step(0, 4, 0, 0, "int[] arr is shorter than top (0) — pop and measure", 2),
        new Step(4, 8, 1, 0, "bar 2 is lower — pop 0; best stays 4", 5),
        new Step(8, 12, 2, 0, "bar 1 is lower — pop 1; best stays 4", 6),
        new Step(12, 16, 3, 2, "bar 5 is taller — keep it open", 3),
        new Step(16, 20, 4, 2, "bar 6 is taller — keep it open", 3),
        new Step(20, 24, 5, 2, "pop 6 and 5 — width expands; area = 5 × 2 = 10", 7),
        new Step(24, 28, 6, 5, "push 6 — remaining bars stay open", 9),
        new Step(28, 33, 7, 2, "sentinel 0 closes the stack; best remains 10", 7),
        new Step(33, 36.8, 7, 2, "stack empty — Largest rectangle = 10", 12)
    };

    static final String[] CODE = {
        "public static int largestRectangle(int[] h) {",
        "    Deque<Integer> stack = new ArrayDeque<>();",
        "    int best = 0;",
        "    for (int i = 0; i <= h.length; i++) {",
        "        int cur = i == h.length ? 0 : h[i];",
        "        while (!stack.isEmpty() && h[stack.peek()] > cur) {",
        "            int height = h[stack.pop()];",
        "            int left = stack.isEmpty() ? 0 : stack.peek() + 1;",
        "            best = Math.max(best, height * (i - left));",
        "        }",
        "        stack.push(i);",
        "    }",
        "    return best;",
        "}"
    };

    public static void main(String[] args) throws Exception {
        String ffmpeg = args.length > 0 ? args[0] : "ffmpeg";
        Path out = Path.of(args.length > 1 ? args[1] : "code-in-motion.mp4").toAbsolutePath();
        Path temp = Files.createTempDirectory("code-in-motion-");
        Path silent = temp.resolve("animation.mp4"), wav = temp.resolve("flute.wav");
        renderVideo(ffmpeg, silent);
        renderFlute(wav);
        Process mux = new ProcessBuilder(ffmpeg, "-y", "-i", silent.toString(), "-i", wav.toString(),
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", out.toString())
                .inheritIO().start();
        if (mux.waitFor() != 0) throw new IOException("FFmpeg mux failed");
        Files.deleteIfExists(silent); Files.deleteIfExists(wav); Files.deleteIfExists(temp);
        System.out.println("Created " + out);
    }

    static void renderVideo(String ffmpeg, Path target) throws Exception {
        Process enc = new ProcessBuilder(ffmpeg, "-y", "-f", "rawvideo", "-pixel_format", "bgr24",
                "-video_size", W + "x" + H, "-framerate", String.valueOf(FPS), "-i", "-",
                "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", target.toString()).redirectError(ProcessBuilder.Redirect.INHERIT).start();
        try (OutputStream os = new BufferedOutputStream(enc.getOutputStream(), 1 << 20)) {
            int frames = (int)Math.round(DURATION * FPS);
            for (int f = 0; f < frames; f++) {
                BufferedImage img = draw(f / (double)FPS);
                os.write(((DataBufferByte)img.getRaster().getDataBuffer()).getData());
            }
        }
        if (enc.waitFor() != 0) throw new IOException("FFmpeg encode failed");
    }

    static BufferedImage draw(double t) {
        BufferedImage im = new BufferedImage(W, H, BufferedImage.TYPE_3BYTE_BGR);
        Graphics2D g = im.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        GradientPaint bg = new GradientPaint(0, 0, new Color(245, 251, 254), W, H, new Color(238, 250, 246));
        g.setPaint(bg); g.fillRect(0, 0, W, H);
        drawGrid(g);
        header(g);
        card(g, 10, 31, 486, 170, 18);
        centered(g, "ALGORITHMS  •  STACK", 58, 9, Font.BOLD, CYAN);
        centered(g, "Largest rectangle in a histogram", 88, 22, Font.BOLD, INK);
        centered(g, "Given bar heights, find the largest rectangle that fits inside", 112, 10, Font.PLAIN, MUTED);
        centered(g, "the histogram. A monotonic stack solves it in linear time.", 126, 10, Font.PLAIN, MUTED);
        centered(g, "[4, 2, 1, 5, 6, 2, 3]  →  10", 148, 14, Font.BOLD, GREEN);
        pill(g, 163, "TIME  O(n)", CYAN); pill(g, 258, "SPACE  O(n)", PINK);

        Step s = STEPS[STEPS.length - 1];
        for (Step x : STEPS) if (t >= x.start && t < x.end) { s = x; break; }
        card(g, 10, 211, 486, 312, 15);
        label(g, "●  LIVE PREVIEW", 23, 232, CYAN, 9, Font.BOLD);
        label(g, "STEP " + Math.min(8, s.index + 1) + " / 8", 430, 232, MUTED, 9, Font.BOLD);
        roundFill(g, 18, 245, 470, 30, 7, new Color(242, 247, 250));
        label(g, s.note, 27, 264, INK, 9, Font.PLAIN);
        label(g, "ARR  [4, 2, 1, 5, 6, 2, 3]", 20, 292, MUTED, 9, Font.BOLD);
        roundFill(g, 426, 279, 54, 22, 7, new Color(224, 248, 231));
        label(g, "best = " + (t < 20 ? 4 : 10), 435, 294, GREEN, 9, Font.BOLD);
        histogram(g, t, s);
        stack(g, s);

        card(g, 10, 535, 486, 314, 15);
        label(g, "●  LargestRectangle.java", 23, 557, new Color(236, 91, 89), 9, Font.BOLD);
        roundFill(g, 461, 545, 23, 18, 6, new Color(228, 244, 250)); label(g, "JAVA", 464, 558, CYAN, 7, Font.BOLD);
        codePanel(g, s.codeLine);
        centered(g, "For more, follow  @code.in.motion", 875, 11, Font.BOLD, GREEN);
        g.dispose(); return im;
    }

    static void histogram(Graphics2D g, double t, Step s) {
        int baseY = 441, x0 = 62, gap = 51, bw = 31, unit = 28;
        g.setColor(new Color(190, 208, 216)); g.drawLine(49, baseY, 456, baseY);
        for (int k = 1; k <= 6; k++) { g.setColor(GRID); g.drawLine(49, baseY-k*unit, 456, baseY-k*unit); label(g,""+k,34,baseY-k*unit+4,new Color(180,195,202),8,Font.PLAIN); }
        for (int i=0;i<BARS.length;i++) {
            double appear = smooth((t - (1.2 + i*3.25))/0.8);
            if (i == 0) appear = smooth(t/0.8);
            int h=(int)(BARS[i]*unit*appear), x=x0+i*gap;
            Color c = i==3 || i==4 ? new Color(102,164,186,170) : new Color(93,106,119,165);
            g.setColor(c); g.fillRoundRect(x,baseY-h,bw,h,4,4);
            if (appear>.15) centeredAt(g,""+BARS[i],x+bw/2,baseY-h-7,9,Font.BOLD,INK);
            centeredAt(g,""+i,x+bw/2,baseY+15,8,Font.PLAIN,MUTED);
        }
        if (t >= 20) {
            double a=smooth((t-20)/1.1); g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER,(float)a));
            g.setColor(new Color(22,177,211,50)); g.fillRect(x0+3*gap,baseY-5*unit,2*gap+bw,5*unit);
            g.setStroke(new BasicStroke(2)); g.setColor(CYAN); g.drawRect(x0+3*gap,baseY-5*unit,2*gap+bw,5*unit);
            roundFill(g, 204, 393, 96, 24, 5, CYAN); centeredAt(g,"5 × 2 = 10",252,410,11,Font.BOLD,Color.WHITE);
            g.setComposite(AlphaComposite.SrcOver);
        }
        if (t >= 33) { roundFill(g, 203, 395, 101, 26, 5, GREEN); centeredAt(g,"Largest = 10",253,413,11,Font.BOLD,Color.WHITE); confetti(g,t); }
    }

    static void stack(Graphics2D g, Step s) {
        label(g,"STACK — bars still open, top on the right",20,485,MUTED,8,Font.BOLD);
        int count = s.index<=0?1:s.index<=2?1:s.index<=4?3:s.index<=6?2:0;
        int[] vals = s.index<=0?new int[]{4}:s.index<=2?new int[]{1}:s.index<=4?new int[]{1,5,6}:new int[]{1,2};
        for(int i=0;i<count;i++){roundFill(g,68+i*45,493,34,24,4,new Color(231,235,239));centeredAt(g,""+vals[i],85+i*45,509,10,Font.BOLD,INK);}
    }

    static void codePanel(Graphics2D g, int active) {
        int y=579;
        for(int i=0;i<CODE.length;i++){
            if(i==active){roundFill(g,18,y-12,470,17,2,new Color(218,239,250)); g.setColor(CYAN);g.fillRect(18,y-12,3,17);}
            label(g,String.format("%2d",i+1),25,y,new Color(148,164,176),8,Font.PLAIN);
            g.setFont(MONO.deriveFont(10f)); g.setColor(i==0||i==12?PINK:INK); g.drawString(CODE[i],48,y); y+=18;
        }
    }

    static void renderFlute(Path path) throws Exception {
        float sr=48000; int n=(int)(DURATION*sr); byte[] data=new byte[n*2];
        int[] midi={69,72,74,76,74,72,69,67,69,72,76,74,72,69,67,64};
        double beat=0.575;
        for(int i=0;i<n;i++){
            double time=i/sr, phrase=time%(midi.length*beat), pos=phrase/beat; int note=(int)pos;
            double local=(pos-note)*beat, f=440*Math.pow(2,(midi[note]-69)/12.0);
            double env=Math.min(1,local/.08)*Math.min(1,(beat-local)/.12);
            double vibrato=Math.sin(2*Math.PI*5.2*time)*0.004;
            double phase=2*Math.PI*f*time + vibrato;
            double breath=(Math.sin(i*12.9898)*43758.5453%1.0)*0.018;
            double sample=env*(0.55*Math.sin(phase)+0.19*Math.sin(2*phase)+0.07*Math.sin(3*phase)+breath);
            sample*=0.34*(Math.min(1,time/1.5))*Math.min(1,(DURATION-time)/1.6);
            short v=(short)Math.max(Short.MIN_VALUE,Math.min(Short.MAX_VALUE,sample*32767)); data[i*2]=(byte)v;data[i*2+1]=(byte)(v>>8);
        }
        AudioFormat fmt=new AudioFormat(sr,16,1,true,false);
        try(AudioInputStream ais=new AudioInputStream(new ByteArrayInputStream(data),fmt,n)){AudioSystem.write(ais,AudioFileFormat.Type.WAVE,path.toFile());}
    }

    static void header(Graphics2D g){ g.setColor(CYAN);g.fillRect(0,0,W,3); label(g,"CODE IN MOTION",412,20,MUTED,7,Font.BOLD); }
    static void drawGrid(Graphics2D g){g.setColor(new Color(226,238,242,120));for(int x=0;x<W;x+=18)g.drawLine(x,0,x,H);for(int y=0;y<H;y+=18)g.drawLine(0,y,W,y);}
    static void card(Graphics2D g,int x,int y,int w,int h,int r){g.setColor(new Color(191,208,217,60));g.fillRoundRect(x+2,y+5,w,h,r,r);g.setColor(new Color(255,255,255,235));g.fillRoundRect(x,y,w,h,r,r);}
    static void pill(Graphics2D g,int x,String text,Color c){roundFill(g,x,162,85,24,12,new Color(c.getRed(),c.getGreen(),c.getBlue(),24));centeredAt(g,text,x+42,178,9,Font.BOLD,c);}
    static void roundFill(Graphics2D g,int x,int y,int w,int h,int r,Color c){g.setColor(c);g.fillRoundRect(x,y,w,h,r,r);}
    static void label(Graphics2D g,String s,int x,int y,Color c,float size,int style){g.setFont(SANS.deriveFont(style,size));g.setColor(c);g.drawString(s,x,y);}
    static void centered(Graphics2D g,String s,int y,float size,int style,Color c){g.setFont(SANS.deriveFont(style,size));g.setColor(c);g.drawString(s,(W-g.getFontMetrics().stringWidth(s))/2,y);}
    static void centeredAt(Graphics2D g,String s,int cx,int y,float size,int style,Color c){g.setFont(SANS.deriveFont(style,size));g.setColor(c);g.drawString(s,cx-g.getFontMetrics().stringWidth(s)/2,y);}
    static double smooth(double x){x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);}
    static void confetti(Graphics2D g,double t){Random r=new Random(19);for(int i=0;i<44;i++){int x=40+r.nextInt(426), y=312+r.nextInt(155)+(int)((t-33)*12);g.setColor(i%2==0?CYAN:i%3==0?PINK:GREEN);g.fill(new Ellipse2D.Double(x,y,3,3));}}
}
