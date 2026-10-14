import { describe, expect, it } from 'vitest'
import { replayOnboarding, type DnaWindowEntry } from '../src/components/dna/useDnaSessionTracker'

const KICKOFF = 'Olá! Estou pronto para mapear o DNA da minha marca.'
const SKIP = 'Pular este bloco, por favor.'

function userEntry(text: string): DnaWindowEntry {
  return {
    type: 'event',
    event: {
      type: 'user/message',
      data: {
        message: {
          content: [{ type: 'text', text }],
        },
      },
    },
  }
}

function assistantEntry(text: string): DnaWindowEntry {
  return {
    type: 'event',
    event: {
      type: 'assistant/message',
      data: {
        message: {
          content: [{ type: 'text', text }],
        },
      },
    },
  }
}

describe('replayOnboarding', () => {
  it('kickoff exato: inicia tracking e registra resposta do bloco 1', () => {
    const entries: DnaWindowEntry[] = [
      userEntry(KICKOFF),
      assistantEntry('Olá! Qual o nome da sua oferta ou produto?'),
      userEntry('CopyMonster'),
      assistantEntry('Excelente! Vamos ao Bloco 1: Público-alvo. Quem é seu cliente ideal?'),
      userEntry('Criadores de conteúdo e infoprodutores digitais'),
      assistantEntry('Perfeito. Anotado público-alvo.'),
    ]

    const replay = replayOnboarding(entries, KICKOFF, SKIP)

    expect(replay.started).toBe(true)
    expect(replay.detectedProductName).toBe('CopyMonster')
    expect(replay.answeredBlocks).toHaveLength(1)
    expect(replay.answeredBlocks[0]).toMatchObject({
      block: 1,
      assistantText: 'Perfeito. Anotado público-alvo.',
    })
    expect(replay.answeredBlock).toBe(1)
    expect(replay.nextAnswerBlock).toBe(2)
  })

  it('sem kickoff: mensagem inicial "oi" não inicia tracking antes de resposta do assistente', () => {
    const entries: DnaWindowEntry[] = [
      userEntry('oi'),
      assistantEntry('Olá! Sou o Brand Positioning Monster. Qual o nome do produto?'),
      userEntry('Monster SaaS'),
      assistantEntry('Ótimo! Bloco 1: quem é seu público?'),
      userEntry('Agências de marketing'),
    ]

    const replay = replayOnboarding(entries, KICKOFF, SKIP)

    expect(replay.started).toBe(true)
    expect(replay.detectedProductName).toBe('Monster SaaS')
    expect(replay.answeredBlocks).toHaveLength(1)
    expect(replay.answeredBlocks[0]?.block).toBe(1)
    expect(replay.answeredBlock).toBe(1)
    expect(replay.nextAnswerBlock).toBe(2)
  })

  it('skip text avança próximo bloco sem salvar item em answeredBlocks', () => {
    const entries: DnaWindowEntry[] = [
      userEntry(KICKOFF),
      assistantEntry('Qual o nome do produto?'),
      userEntry('Produto Alpha'),
      assistantEntry('Bloco 1: Público-alvo?'),
      userEntry('Estudantes de tecnologia'),
      assistantEntry('Bloco 2: Dores e desafios?'),
      userEntry(SKIP),
      assistantEntry('Bloco 3: Solução e benefícios?'),
      userEntry('Plataforma completa de aprendizado'),
    ]

    const replay = replayOnboarding(entries, KICKOFF, SKIP)

    expect(replay.started).toBe(true)
    expect(replay.detectedProductName).toBe('Produto Alpha')
    expect(replay.answeredBlocks.map(item => item.block)).toEqual([1, 3])
    expect(replay.answeredBlock).toBe(3)
    expect(replay.nextAnswerBlock).toBe(4)
  })

  it('bloco 0 captura detectedProductName corretamente', () => {
    const entries: DnaWindowEntry[] = [
      assistantEntry('Boas-vindas! Me diga o nome do seu produto.'),
      userEntry('CopyMonster Launch'),
    ]

    const replay = replayOnboarding(entries, KICKOFF, SKIP)

    expect(replay.started).toBe(true)
    expect(replay.detectedProductName).toBe('CopyMonster Launch')
    expect(replay.answeredBlocks).toHaveLength(0)
    expect(replay.nextAnswerBlock).toBe(1)
  })

  it('múltiplas respostas: answeredBlocks contém todos os blocos até o 12', () => {
    const entries: DnaWindowEntry[] = [
      userEntry(KICKOFF),
      assistantEntry('Qual o nome do produto?'),
      userEntry('Produto Completo'),
    ]

    for (let block = 1; block <= 12; block += 1) {
      entries.push(assistantEntry(`Pergunta do bloco ${block}`))
      entries.push(userEntry(`Resposta do bloco ${block}`))
    }

    const replay = replayOnboarding(entries, KICKOFF, SKIP)

    expect(replay.started).toBe(true)
    expect(replay.detectedProductName).toBe('Produto Completo')
    expect(replay.answeredBlocks).toHaveLength(12)
    expect(replay.answeredBlocks.map(item => item.block)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
    expect(replay.answeredBlock).toBe(12)
    expect(replay.nextAnswerBlock).toBe(13)
  })
})
