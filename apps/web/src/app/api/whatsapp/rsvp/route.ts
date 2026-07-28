import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  isValidWhatsappBotToken,
  normalizePhone,
} from '@/lib/whatsapp-bot-auth';
import { findOrLinkWhatsappUser } from '@/lib/whatsapp-user-lookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RsvpBody = {
  whatsappMessageId?: string;
  reactorPhone?: string;
  reactorLid?: string | null;
  reactorJid?: string | null;
  status?: 'attending' | 'cancelled' | string;
  confidence?: number;
};

/**
 * POST /api/whatsapp/rsvp
 *
 * Secured bridge endpoint used by `scripts/whatsapp-bot.js` when Grok
 * (or a thumbs-up / tennis-ball reaction) signals RSVP_YES / RSVP_NO.
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('x-whatsapp-bot-token');
    if (!isValidWhatsappBotToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as RsvpBody;
    const whatsappMessageId = (body.whatsappMessageId ?? '').trim();
    const reactorPhone = normalizePhone(body.reactorPhone ?? '');
    const reactorLid = normalizePhone(body.reactorLid ?? '');
    const status = body.status;

    if (!whatsappMessageId || (!reactorPhone && !reactorLid)) {
      return NextResponse.json(
        { error: 'whatsappMessageId and reactorPhone or reactorLid are required' },
        { status: 400 },
      );
    }

    if (status !== 'attending' && status !== 'cancelled') {
      return NextResponse.json(
        { error: 'status must be "attending" or "cancelled"' },
        { status: 400 },
      );
    }

    const event = await prisma.event.findUnique({
      where: { whatsappMessageId },
      select: {
        id: true,
        title: true,
        status: true,
        whatsappMessageId: true,
      },
    });

    if (!event) {
      return NextResponse.json(
        {
          error: 'No event found for whatsappMessageId',
          whatsappMessageId,
        },
        { status: 404 },
      );
    }

    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      return NextResponse.json(
        {
          error: `Event is ${event.status.toLowerCase()} and no longer accepts RSVPs`,
          eventId: event.id,
        },
        { status: 409 },
      );
    }

    const user = await findOrLinkWhatsappUser(prisma, {
      senderPhone: reactorPhone || null,
      senderLid: reactorLid || null,
      senderJid: body.reactorJid,
    });

    if (!user) {
      return NextResponse.json(
        {
          error: 'No user found for WhatsApp reactor',
          reactorPhone: reactorPhone || null,
          reactorLid: reactorLid || null,
          hint: 'Sign up with your phone on MKE Plays so we can link your WhatsApp identity.',
        },
        { status: 404 },
      );
    }

    if (status === 'attending') {
      const rsvp = await prisma.rsvp.upsert({
        where: {
          eventId_userId: { eventId: event.id, userId: user.id },
        },
        create: {
          eventId: event.id,
          userId: user.id,
          status: 'GOING',
        },
        update: {
          status: 'GOING',
        },
        select: {
          id: true,
          eventId: true,
          userId: true,
          status: true,
        },
      });

      return NextResponse.json({
        ok: true,
        action: 'attending',
        event: { id: event.id, title: event.title },
        rsvp,
      });
    }

    // cancelled → mark DECLINED (keeps history) rather than hard-deleting.
    const existing = await prisma.rsvp.findUnique({
      where: {
        eventId_userId: { eventId: event.id, userId: user.id },
      },
      select: { id: true },
    });

    if (!existing) {
      // Nothing to cancel; create an explicit DECLINED row for auditability.
      const rsvp = await prisma.rsvp.create({
        data: {
          eventId: event.id,
          userId: user.id,
          status: 'DECLINED',
        },
        select: {
          id: true,
          eventId: true,
          userId: true,
          status: true,
        },
      });

      return NextResponse.json({
        ok: true,
        action: 'cancelled',
        event: { id: event.id, title: event.title },
        rsvp,
      });
    }

    const rsvp = await prisma.rsvp.update({
      where: {
        eventId_userId: { eventId: event.id, userId: user.id },
      },
      data: { status: 'DECLINED' },
      select: {
        id: true,
        eventId: true,
        userId: true,
        status: true,
      },
    });

    return NextResponse.json({
      ok: true,
      action: 'cancelled',
      event: { id: event.id, title: event.title },
      rsvp,
    });
  } catch (err) {
    console.error('[api/whatsapp/rsvp]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
