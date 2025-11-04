// Word Search Game Implementation

interface Position {
    row: number;
    col: number;
}

interface WordPlacement {
    word: string;
    start: Position;
    direction: Direction;
}

type Direction = 'horizontal' | 'vertical' | 'diagonal';

class WordSearchGame {
    private grid: string[][] = [];
    private words: string[] = [
        'INQUIRY', 'BELIEF', 'PARTS', 'SELF', 'MANAGER',
        'EXILE', 'CURIOUS', 'QUESTION', 'BURDEN', 'FREEDOM',
        'UNBURDENED', 'COMPASSION'
    ];
    private gridSize = 15;
    private foundWords: Set<string> = new Set();
    private selectedCells: Position[] = [];
    private wordPlacements: WordPlacement[] = [];

    constructor(private container: HTMLElement) {
        this.initializeGrid();
        this.placeWords();
        this.fillEmptyCells();
        this.render();
    }

    private initializeGrid(): void {
        for (let i = 0; i < this.gridSize; i++) {
            this.grid[i] = new Array(this.gridSize).fill('');
        }
    }

    private placeWords(): void {
        const shuffledWords = [...this.words].sort(() => Math.random() - 0.5);

        for (const word of shuffledWords) {
            let placed = false;
            let attempts = 0;

            while (!placed && attempts < 100) {
                const direction = this.getRandomDirection();
                const position = this.getRandomStartPosition(word.length, direction);

                if (this.canPlaceWord(word, position, direction)) {
                    this.placeWord(word, position, direction);
                    placed = true;
                }
                attempts++;
            }
        }
    }

    private getRandomDirection(): Direction {
        const directions: Direction[] = ['horizontal', 'vertical', 'diagonal'];
        return directions[Math.floor(Math.random() * directions.length)];
    }

    private getRandomStartPosition(wordLength: number, direction: Direction): Position {
        let maxRow = this.gridSize;
        let maxCol = this.gridSize;

        if (direction === 'horizontal') {
            maxCol = this.gridSize - wordLength;
        } else if (direction === 'vertical') {
            maxRow = this.gridSize - wordLength;
        } else { // diagonal
            maxRow = this.gridSize - wordLength;
            maxCol = this.gridSize - wordLength;
        }

        return {
            row: Math.floor(Math.random() * Math.max(1, maxRow)),
            col: Math.floor(Math.random() * Math.max(1, maxCol))
        };
    }

    private canPlaceWord(word: string, start: Position, direction: Direction): boolean {
        for (let i = 0; i < word.length; i++) {
            const pos = this.getPositionAt(start, i, direction);
            if (pos.row >= this.gridSize || pos.col >= this.gridSize) {
                return false;
            }
            const currentChar = this.grid[pos.row][pos.col];
            if (currentChar !== '' && currentChar !== word[i]) {
                return false;
            }
        }
        return true;
    }

    private placeWord(word: string, start: Position, direction: Direction): void {
        for (let i = 0; i < word.length; i++) {
            const pos = this.getPositionAt(start, i, direction);
            this.grid[pos.row][pos.col] = word[i];
        }
        this.wordPlacements.push({ word, start, direction });
    }

    private getPositionAt(start: Position, offset: number, direction: Direction): Position {
        switch (direction) {
            case 'horizontal':
                return { row: start.row, col: start.col + offset };
            case 'vertical':
                return { row: start.row + offset, col: start.col };
            case 'diagonal':
                return { row: start.row + offset, col: start.col + offset };
        }
    }

    private fillEmptyCells(): void {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                if (this.grid[row][col] === '') {
                    this.grid[row][col] = letters[Math.floor(Math.random() * letters.length)];
                }
            }
        }
    }

    private render(): void {
        const gridContainer = document.createElement('div');
        gridContainer.className = 'word-grid';
        gridContainer.style.gridTemplateColumns = `repeat(${this.gridSize}, 40px)`;

        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                const cell = document.createElement('div');
                cell.className = 'word-cell';
                cell.textContent = this.grid[row][col];
                cell.dataset.row = row.toString();
                cell.dataset.col = col.toString();

                cell.addEventListener('mousedown', () => this.startSelection(row, col));
                cell.addEventListener('mouseenter', () => this.continueSelection(row, col));
                cell.addEventListener('mouseup', () => this.endSelection());

                gridContainer.appendChild(cell);
            }
        }

        this.container.innerHTML = '';
        this.container.appendChild(gridContainer);

        document.addEventListener('mouseup', () => this.endSelection());
    }

    private startSelection(row: number, col: number): void {
        this.selectedCells = [{ row, col }];
        this.highlightSelection();
    }

    private continueSelection(row: number, col: number): void {
        if (this.selectedCells.length > 0) {
            this.selectedCells.push({ row, col });
            this.highlightSelection();
        }
    }

    private endSelection(): void {
        if (this.selectedCells.length > 1) {
            this.checkWord();
        }
        this.selectedCells = [];
        this.clearSelection();
    }

    private highlightSelection(): void {
        document.querySelectorAll('.word-cell').forEach(cell => {
            cell.classList.remove('selected');
        });

        this.selectedCells.forEach(pos => {
            const cell = this.getCellElement(pos.row, pos.col);
            if (cell) cell.classList.add('selected');
        });
    }

    private clearSelection(): void {
        document.querySelectorAll('.word-cell.selected').forEach(cell => {
            cell.classList.remove('selected');
        });
    }

    private checkWord(): void {
        const selectedWord = this.selectedCells
            .map(pos => this.grid[pos.row][pos.col])
            .join('');

        if (this.words.includes(selectedWord) && !this.foundWords.has(selectedWord)) {
            this.foundWords.add(selectedWord);
            this.markWordAsFound(selectedWord);
            this.updateWordList(selectedWord);

            if (this.foundWords.size === this.words.length) {
                setTimeout(() => alert('Congratulations! You found all the words!'), 100);
            }
        }
    }

    private markWordAsFound(word: string): void {
        const placement = this.wordPlacements.find(p => p.word === word);
        if (placement) {
            for (let i = 0; i < word.length; i++) {
                const pos = this.getPositionAt(placement.start, i, placement.direction);
                const cell = this.getCellElement(pos.row, pos.col);
                if (cell) cell.classList.add('found');
            }
        }
    }

    private updateWordList(word: string): void {
        const wordListItems = document.querySelectorAll('.word-list-item');
        wordListItems.forEach(item => {
            if (item.textContent === word) {
                item.classList.add('found');
            }
        });
    }

    private getCellElement(row: number, col: number): HTMLElement | null {
        return document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('word-search-game');
    if (container) {
        new WordSearchGame(container);
    }
});
